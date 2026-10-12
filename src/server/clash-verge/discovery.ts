import { lstat, readFile } from "node:fs/promises"
import path from "node:path"
import { runCommand } from "@server/common/collect"
import { CLASH_VERGE_PROFILE_DIR, env } from "@server/env"
import { parse as parseYaml } from "yaml"
import {
  ControllerError,
  type ControllerTarget,
  requestJson,
} from "./transport"

/**
 * 控制接口自动发现。
 *
 * 内核的暴露方式取决于 Clash Verge 的运行模式：
 * - 服务模式：内核以 root 运行，只开 -ext-ctl-unix 指定的 socket
 *   （实测：/var/run/clash-verge-service/users/<uid>/verge-mihomo.sock，属主是当前用户，
 *   普通用户进程可以直接连；root 侧的运行时配置读不到，所以不能从那里拿 secret）。
 * - 普通模式：内核按用户态生成配置里的 external-controller 开回环 TCP。
 *
 * 因此按「显式配置 → 约定路径 → 用户态配置 → 运行中的进程参数」依次尝试，
 * 命中一个可用目标就缓存下来；只有能通过 /version 身份校验的才算控制接口。
 */

/** 命中后的缓存时长：status 每次要打三个上游请求，不缓存会反复探测。 */
const TARGET_TTL_MS = 30_000
/** 全部候选都失败后的退避：避免每个请求都重跑一遍发现流程。 */
const BACKOFF_MS = 5_000
/** 发现阶段的单候选超时：比正常请求短，避免一次刷新卡好几秒。 */
const PROBE_TIMEOUT_MS = 1200

const SERVICE_SOCKET_DIR = "/var/run/clash-verge-service/users"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const parseYamlRecord = (text: string): Record<string, unknown> => {
  try {
    const parsed: unknown = parseYaml(text)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** 显式配置的 socket 路径：存在且确实是 socket 才可用。 */
export const isUsableSocket = async (socketPath: string): Promise<boolean> => {
  try {
    return (await lstat(socketPath)).isSocket()
  } catch {
    return false
  }
}

/**
 * 本机服务模式下的约定 socket 路径。
 * 只列内核自己的 socket：/var/run/clash-verge-service/service.sock 是 Clash Verge
 * 特权 helper 的 IPC，singleton-instance.json 是 App 的单实例通道，都不是控制接口。
 */
export const conventionalSocketPaths = (uid: number | undefined): string[] =>
  uid === undefined ? [] : [`${SERVICE_SOCKET_DIR}/${uid}/verge-mihomo.sock`]

/** 只接受回环 TCP 地址；其它主机（含代理、域名）一律拒绝，避免把 secret 发到外部。 */
export const parseLoopbackTcp = (
  value: string | undefined
): ControllerTarget | null => {
  const text = (value ?? "").trim()
  if (!text) return null
  const withScheme = text.startsWith("http://") ? text : `http://${text}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.protocol !== "http:" || url.username || url.password) return null
  if (!["127.0.0.1", "[::1]"].includes(url.hostname)) return null
  if (!url.port) return null
  return { kind: "tcp", baseUrl: new URL(`${url.protocol}//${url.host}`) }
}

/** 用户态生成配置里的控制接口：socket 优先，其次是被显式打开的回环 TCP。 */
export const candidatesFromConfigTexts = (texts: {
  config?: string
  clashVerge?: string
  verge?: string
}): ControllerTarget[] => {
  const merged = {
    ...parseYamlRecord(texts.clashVerge ?? ""),
    ...parseYamlRecord(texts.config ?? ""),
  }
  const verge = parseYamlRecord(texts.verge ?? "")
  const targets: ControllerTarget[] = []
  const socket = merged["external-controller-unix"]
  if (typeof socket === "string" && socket.startsWith("/")) {
    targets.push({ kind: "unix", socketPath: socket })
  }
  if (verge.enable_external_controller !== false) {
    const tcp = parseLoopbackTcp(
      typeof merged["external-controller"] === "string"
        ? merged["external-controller"]
        : undefined
    )
    if (tcp) targets.push(tcp)
  }
  return targets
}

/**
 * 运行中内核的启动参数：-ext-ctl-unix <path> / -ext-ctl <host:port>。
 * 只在配置文件对不上时兜底，所以匹配写得严一些：只认 mihomo 进程行与回环地址。
 */
export const candidatesFromProcessArgs = (
  psOutput: string
): ControllerTarget[] => {
  const targets: ControllerTarget[] = []
  for (const line of psOutput.split("\n")) {
    if (!/mihomo/.test(line)) continue
    const socket = /-ext-ctl-unix(?:=|\s+)(\S+)/.exec(line)?.[1]
    if (socket?.startsWith("/")) {
      targets.push({ kind: "unix", socketPath: socket })
    }
    const tcp = parseLoopbackTcp(/-ext-ctl(?!-)(?:=|\s+)(\S+)/.exec(line)?.[1])
    if (tcp) targets.push(tcp)
  }
  return targets
}

/**
 * 显式配置：存在即视为权威，不再探测，免得把用户配错的地址悄悄换成自动发现的结果。
 * 地址不合法或不是回环时直接报错，绝不把请求（带 secret）发到外部主机。
 */
export const explicitTarget = (): ControllerTarget | null => {
  const socketPath = (env.CLASH_VERGE_CONTROLLER_UNIX_SOCKET ?? "").trim()
  if (socketPath) return { kind: "unix", socketPath }
  const url = (env.CLASH_VERGE_CONTROLLER_URL ?? "").trim()
  if (!url) return null
  const target = parseLoopbackTcp(url)
  if (!target) {
    throw new ControllerError(
      "CLASH_VERGE_CONTROLLER_URL 必须是本机回环 HTTP 地址（http://127.0.0.1:<端口> 或 http://[::1]:<端口>）",
      "not_configured"
    )
  }
  return target
}

const readText = async (file: string): Promise<string | undefined> => {
  try {
    return await readFile(file, "utf8")
  } catch {
    return undefined
  }
}

/** 自动发现的候选来源，与显式配置无关。 */
export const discoveredCandidates = async (
  options: {
    uid?: number | undefined
    appDir?: string
    psOutput?: () => Promise<string>
  } = {}
): Promise<ControllerTarget[]> => {
  const uid = options.uid === undefined ? process.getuid?.() : options.uid
  const appDir = options.appDir ?? path.dirname(CLASH_VERGE_PROFILE_DIR)
  const candidates: ControllerTarget[] = []

  for (const socketPath of conventionalSocketPaths(uid)) {
    if (await isUsableSocket(socketPath)) {
      candidates.push({ kind: "unix", socketPath })
    }
  }

  const [config, clashVerge, verge] = await Promise.all([
    readText(path.join(appDir, "config.yaml")),
    readText(path.join(appDir, "clash-verge.yaml")),
    readText(path.join(appDir, "verge.yaml")),
  ])
  for (const target of candidatesFromConfigTexts({
    config,
    clashVerge,
    verge,
  })) {
    if (target.kind === "unix") {
      if (await isUsableSocket(target.socketPath)) candidates.push(target)
    } else {
      candidates.push(target)
    }
  }

  const readProcesses =
    options.psOutput ?? (() => runCommand("/bin/ps", ["-Ao", "args="]))
  try {
    const psOutput = await readProcesses()
    for (const target of candidatesFromProcessArgs(psOutput)) {
      if (target.kind === "unix") {
        if (await isUsableSocket(target.socketPath)) candidates.push(target)
      } else {
        candidates.push(target)
      }
    }
  } catch {
    // ps 不可用只影响兜底来源，不影响其它候选
  }

  return dedupe(candidates)
}

const dedupe = (targets: ControllerTarget[]): ControllerTarget[] => {
  const seen = new Set<string>()
  return targets.filter((target) => {
    const key =
      target.kind === "unix"
        ? `unix:${target.socketPath}`
        : `tcp:${target.baseUrl.href}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 身份校验：只有 /version 返回 {meta:boolean, version:string} 才算内核控制接口。 */
export const isControllerPayload = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.version === "string" &&
  typeof value.meta === "boolean"

type ProbeResult = "ok" | "needs_secret" | "reject"

const probe = async (
  target: ControllerTarget,
  timeoutMs: number
): Promise<ProbeResult> => {
  try {
    const payload = await requestJson(target, "/version", { timeoutMs })
    return isControllerPayload(payload) ? "ok" : "reject"
  } catch (error) {
    // 401/403 说明这里确实是控制接口，只是要 secret：选它，让上层给出认证提示
    if (error instanceof ControllerError && error.kind === "unauthorized") {
      return "needs_secret"
    }
    return "reject"
  }
}

let cached: { target: ControllerTarget; at: number } | null = null
let lastFailure: { error: ControllerError; at: number } | null = null

/** 不可达或用户改了配置后调用：下一次请求重新发现。 */
export const resetControllerTarget = (): void => {
  cached = null
  lastFailure = null
}

export const resolveControllerTarget = async (
  options: {
    /** 测试注入的候选列表；不传就走真实的约定路径/配置/进程参数。 */
    candidates?: ControllerTarget[]
    now?: () => number
    probeTimeoutMs?: number
  } = {}
): Promise<ControllerTarget> => {
  const now = options.now ?? Date.now
  const explicit = explicitTarget()
  if (explicit) {
    if (
      explicit.kind === "unix" &&
      !(await isUsableSocket(explicit.socketPath))
    ) {
      throw new ControllerError(
        `CLASH_VERGE_CONTROLLER_UNIX_SOCKET 指向的不是可用的 socket：${explicit.socketPath}`,
        "not_configured"
      )
    }
    return explicit
  }

  if (cached && now() - cached.at < TARGET_TTL_MS) return cached.target
  if (lastFailure && now() - lastFailure.at < BACKOFF_MS) {
    throw lastFailure.error
  }

  const enabled = env.CLASH_VERGE_AUTO_DISCOVER !== "0"
  const candidates = enabled
    ? (options.candidates ?? (await discoveredCandidates()))
    : []
  const timeoutMs = options.probeTimeoutMs ?? PROBE_TIMEOUT_MS
  const tried: string[] = []

  for (const candidate of candidates) {
    tried.push(
      candidate.kind === "unix" ? candidate.socketPath : candidate.baseUrl.href
    )
    const result = await probe(candidate, timeoutMs)
    if (result !== "reject") {
      cached = { target: candidate, at: now() }
      lastFailure = null
      return candidate
    }
  }

  const error = new ControllerError(
    enabled
      ? "未发现可用的 Clash Verge 控制接口：已尝试系统 socket、用户配置与运行中的内核参数，可在 .env 配置 CLASH_VERGE_CONTROLLER_UNIX_SOCKET 指定"
      : "Clash Verge 自动发现已关闭，且没有配置 CLASH_VERGE_CONTROLLER_UNIX_SOCKET 或 CLASH_VERGE_CONTROLLER_URL",
    "not_configured"
  )
  lastFailure = { error, at: now() }
  // 只记候选地址，不含任何凭据
  console.warn(
    `[mac-manager] Clash Verge 控制接口未发现，已尝试：${tried.join("、") || "无候选"}`
  )
  throw error
}
