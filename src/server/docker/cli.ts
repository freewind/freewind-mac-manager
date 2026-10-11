import { execFile } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { cached } from "@server/common/collect"
import {
  DOCKER_CONTAINER_STATES,
  type DockerColimaStatus,
  type DockerContainer,
  type DockerContainerLogsResponse,
  type DockerImage,
  type DockerMount,
  type DockerNetwork,
  type DockerPortMapping,
  type DockerVolume,
} from "@shared/api-contract"

/** 单条命令的输出上限，避免异常输出把内存撑爆。 */
const MAX_BUFFER = 8 * 1024 * 1024

const TIMEOUT = {
  /** version 这类极轻的命令 */
  quick: 15_000,
  /** 列表查询：容器多时 ps -a 会慢一些 */
  list: 30_000,
  logs: 30_000,
  /** colima start 要拉虚拟机，给足时间（页面侧仍按长任务处理） */
  colimaStart: 300_000,
  colimaStop: 120_000,
} as const

/** 只读列表的短 TTL：页面几秒刷新一次，缓存只为避免重复压机器。 */
const TTL = {
  containers: 3_000,
  images: 10_000,
  volumes: 10_000,
  networks: 10_000,
  info: 10_000,
  version: 60_000,
} as const

export type DockerErrorKind =
  | "not_installed"
  | "daemon_unavailable"
  | "timeout"
  | "invalid_input"
  | "failed"

/**
 * docker/colima 调用的统一错误：带上可判定的种类与中文说明。
 * handler 按 kind 决定 HTTP 状态，不再解析原始 stderr。
 */
export class DockerCommandError extends Error {
  readonly kind: DockerErrorKind
  /** 原始错误文本（stderr 摘要），用于排查与二次判定。 */
  readonly detail: string

  constructor(kind: DockerErrorKind, message: string, detail = "") {
    super(message)
    this.name = "DockerCommandError"
    this.kind = kind
    this.detail = detail
  }
}

export type CommandOutput = { stdout: string; stderr: string }

export type CommandOptions = { timeoutMs: number }

export type DockerCommandRunner = (
  command: string,
  args: string[],
  options: CommandOptions
) => Promise<CommandOutput>

export type DockerCache = <T>(
  key: string,
  ttl: number,
  load: () => Promise<T>
) => Promise<T>

/**
 * 默认执行器：参数一律走数组传给 execFile，绝不经过 shell，
 * 因此不存在拼接注入；这里只负责把 Node 的错误原样抛出并附上 stderr，
 * 中文错误映射统一由 cli 层做，便于用受控替身测试。
 */
export const execCommand: DockerCommandRunner = (
  command,
  args,
  { timeoutMs }
) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { maxBuffer: MAX_BUFFER, timeout: timeoutMs, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stderr }))
          return
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "" })
      }
    )
  })

const HOME_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"]

/**
 * 可执行文件优先用 PATH 里的名字；服务由 launchd 拉起时 PATH 往往很短，
 * 所以 PATH 找不到时再补几个常见安装目录（Homebrew 与 docker CLI 插件目录）。
 */
const commandCandidates = (command: string): string[] => [
  command,
  ...HOME_BIN_DIRS.map((dir) => path.join(dir, command)),
  path.join(os.homedir(), ".docker", "bin", command),
]

const firstMeaningfulLine = (text: string): string | null => {
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (line.length === 0) continue
    if (/^Command failed:/i.test(line)) continue
    return line
  }
  return null
}

const NOT_INSTALLED_MESSAGE: Record<string, string> = {
  docker: "未找到 docker 命令，请确认 Docker 或 Colima 已安装。",
  colima: "未找到 colima 命令，请先安装 Colima。",
}

/** 把 Node 的 execFile 错误翻译成可判定的中文错误。 */
export const toCommandError = (
  command: string,
  error: unknown,
  timeoutMs: number
): DockerCommandError => {
  if (error instanceof DockerCommandError) return error
  const label = path.basename(command)
  const record = (error ?? {}) as {
    code?: unknown
    killed?: unknown
    signal?: unknown
    message?: unknown
    stderr?: unknown
  }
  const stderr = typeof record.stderr === "string" ? record.stderr : ""
  const detail = (stderr || String(record.message ?? "")).trim()

  if (record.code === "ENOENT") {
    return new DockerCommandError(
      "not_installed",
      NOT_INSTALLED_MESSAGE[label] ?? `未找到 ${label} 命令，请确认已安装。`,
      detail
    )
  }
  if (record.killed || record.signal) {
    return new DockerCommandError(
      "timeout",
      `${label} 命令执行超时（超过 ${Math.round(timeoutMs / 1000)} 秒），已终止。`,
      detail
    )
  }
  if (
    label === "docker" &&
    /cannot connect to the docker daemon|is the docker daemon running|error during connect/i.test(
      detail
    )
  ) {
    return new DockerCommandError(
      "daemon_unavailable",
      "Docker 服务未运行，请先启动 Docker 或执行 colima start。",
      detail
    )
  }
  const summary = firstMeaningfulLine(detail) ?? "未知原因"
  return new DockerCommandError(
    "failed",
    `${label} 命令执行失败：${summary}`,
    detail
  )
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {}

const asText = (value: unknown): string =>
  typeof value === "string" ? value : value == null ? "" : String(value)

const asNumber = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const parseJsonValue = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * docker 的 --format json 是「每行一个 JSON 对象」，不是 JSON 数组，
 * 因此按行解析；坏行跳过而不是让整次读取失败。
 */
export const parseJsonLines = (text: string): unknown[] => {
  const values: unknown[] = []
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line.startsWith("{")) continue
    const value = parseJsonValue(line)
    if (value !== null) values.push(value)
  }
  return values
}

const SIZE_UNITS: Record<string, number> = {
  B: 1,
  KB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
  TB: 1000 ** 4,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3,
  TIB: 1024 ** 4,
}

/** "187MB" → 字节数；"N/A" 或无法识别时返回 null。 */
export const parseDockerSize = (text: string): number | null => {
  const match = /^([\d.]+)\s*([A-Za-z]+)$/.exec(text.trim())
  if (!match) return null
  const unit = SIZE_UNITS[(match[2] ?? "").toUpperCase()]
  const value = Number(match[1])
  if (!unit || !Number.isFinite(value)) return null
  return Math.round(value * unit)
}

/**
 * docker 的时间形如 "2024-01-01 12:00:00 +0800 CST"，
 * 去掉时区名、把空格换成 T 后才能稳定解析；失败返回 null。
 */
export const parseDockerTime = (text: string): number | null => {
  const trimmed = text.trim().replace(/\s+[A-Za-z]{2,6}$/, "")
  if (trimmed.length === 0) return null
  const iso = trimmed
    .replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T")
    .replace(/ ([+-]\d{4})$/, "$1")
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed : null
}

const parseProtocol = (value: string): "tcp" | "udp" =>
  value.trim().toLowerCase() === "udp" ? "udp" : "tcp"

/**
 * 解析 ps 的 Ports 字段，例如
 * "0.0.0.0:8080->80/tcp, :::8080->80/tcp, 9000/udp"。
 * 同一端口 IPv4/IPv6 各打一条，这里按「宿主端口+容器端口+协议」去重；
 * 只声明未发布的端口（"9000/udp"）保留，宿主端口为 null。
 */
export const parseDockerPorts = (text: string): DockerPortMapping[] => {
  const mappings: DockerPortMapping[] = []
  const seen = new Set<string>()
  for (const raw of text.split(",")) {
    const part = raw.trim()
    if (part.length === 0) continue
    const slash = part.lastIndexOf("/")
    const protocol = parseProtocol(slash >= 0 ? part.slice(slash + 1) : "tcp")
    const body = slash >= 0 ? part.slice(0, slash) : part
    const arrow = body.indexOf("->")
    const hostText = arrow >= 0 ? body.slice(0, arrow) : ""
    const containerText = arrow >= 0 ? body.slice(arrow + 2) : body
    const containerPort = asNumber(containerText)
    if (containerPort <= 0) continue
    let hostIp = ""
    let hostPort: number | null = null
    if (arrow >= 0) {
      const colon = hostText.lastIndexOf(":")
      if (colon >= 0) {
        hostIp = hostText.slice(0, colon).replace(/^\[|\]$/g, "")
        const parsed = Number(hostText.slice(colon + 1))
        hostPort = Number.isFinite(parsed) ? parsed : null
      }
    }
    const key = `${hostPort ?? "none"}-${containerPort}-${protocol}`
    if (seen.has(key)) continue
    seen.add(key)
    mappings.push({ hostIp, hostPort, containerPort, protocol })
  }
  return mappings
}

/**
 * 解析 ps 的 Mounts 字段，例如 "myvol:/data, /Users/me/x:/app"。
 * ps 不给出是否只读（只有 inspect 才有），这里一律按可写处理。
 */
export const parseDockerMounts = (text: string): DockerMount[] => {
  const mounts: DockerMount[] = []
  for (const raw of text.split(",")) {
    const part = raw.trim()
    if (part.length === 0) continue
    const colon = part.indexOf(":")
    if (colon <= 0) continue
    const source = part.slice(0, colon).trim()
    const destination = part.slice(colon + 1).trim()
    if (source.length === 0 || destination.length === 0) continue
    mounts.push({
      type: source.startsWith("/") ? "bind" : "volume",
      source,
      destination,
      readOnly: false,
    })
  }
  return mounts
}

const parseContainerState = (value: string): DockerContainer["state"] => {
  const state = value.trim().toLowerCase()
  const states: readonly string[] = DOCKER_CONTAINER_STATES
  return states.includes(state) ? (state as DockerContainer["state"]) : "exited"
}

const splitList = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

/** 解析 ps -a 的 json 行；ps 不提供启动时间与只读标记，这两处留空。 */
export const parseContainers = (text: string): DockerContainer[] =>
  parseJsonLines(text).map((line) => {
    const item = asRecord(line)
    return {
      id: asText(item.ID),
      name: asText(item.Names),
      image: asText(item.Image),
      command: asText(item.Command),
      state: parseContainerState(asText(item.State)),
      status: asText(item.Status),
      createdAt: parseDockerTime(asText(item.CreatedAt)) ?? 0,
      startedAt: null,
      ports: parseDockerPorts(asText(item.Ports)),
      mounts: parseDockerMounts(asText(item.Mounts)),
    }
  })

/** 容器所属网络名（供网络列表统计接入数），来自 ps 的 Networks 字段。 */
const parseContainerNetworks = (text: string): string[][] =>
  parseJsonLines(text).map((line) => splitList(asText(asRecord(line).Networks)))

/** 解析 images 的 json 行；"N/A" 的字段按 0/默认值处理。 */
export const parseImages = (text: string): DockerImage[] =>
  parseJsonLines(text).map((line) => {
    const item = asRecord(line)
    return {
      id: asText(item.ID),
      repository: asText(item.Repository) || "<none>",
      tag: asText(item.Tag) || "<none>",
      sizeBytes: parseDockerSize(asText(item.Size)) ?? 0,
      createdAt: parseDockerTime(asText(item.CreatedAt)) ?? 0,
      containers: asNumber(item.Containers),
    }
  })

/** 解析 network ls 的 json 行；接入容器数要靠容器列表交叉统计，这里先置 0。 */
export const parseNetworks = (text: string): DockerNetwork[] =>
  parseJsonLines(text).map((line) => {
    const item = asRecord(line)
    return {
      id: asText(item.ID),
      name: asText(item.Name),
      driver: asText(item.Driver),
      scope: asText(item.Scope),
      internal: asText(item.Internal).toLowerCase() === "true",
      containers: 0,
    }
  })

/** ps 与 network ls 都不给容器名，只有 volume inspect 能给挂载点。 */
const parseVolumeInspections = (
  text: string
): Map<
  string,
  { mountpoint: string; createdAt: number | null; driver: string }
> => {
  const value = parseJsonValue(text)
  const map = new Map<
    string,
    { mountpoint: string; createdAt: number | null; driver: string }
  >()
  if (!Array.isArray(value)) return map
  for (const item of value) {
    const record = asRecord(item)
    const name = asText(record.Name)
    if (name.length === 0) continue
    map.set(name, {
      mountpoint: asText(record.Mountpoint),
      createdAt: parseDockerTime(asText(record.CreatedAt)),
      driver: asText(record.Driver),
    })
  }
  return map
}

/** 卷名在 docker 里只能是 [A-Za-z0-9][A-Za-z0-9_.-]*，过滤掉异常值再拼参数。 */
const isValidVolumeName = (name: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)

/** 一次 inspect 的卷数上限，避免单条命令参数过长；超出时分批继续。 */
const VOLUME_INSPECT_CHUNK = 200

export type DockerInfo = {
  serverVersion: string
  containersTotal: number
  containersRunning: number
  containersPaused: number
  containersStopped: number
  imagesTotal: number
}

export const parseInfo = (text: string): DockerInfo => {
  const item = asRecord(parseJsonValue(text))
  return {
    serverVersion: asText(item.ServerVersion),
    containersTotal: asNumber(item.Containers),
    containersRunning: asNumber(item.ContainersRunning),
    containersPaused: asNumber(item.ContainersPaused),
    containersStopped: asNumber(item.ContainersStopped),
    imagesTotal: asNumber(item.Images),
  }
}

export const parseVersion = (text: string): string => {
  const item = asRecord(parseJsonValue(text))
  const server = asText(asRecord(item.Server).Version)
  return server || asText(asRecord(item.Client).Version)
}

/**
 * colima status 的输出是几行 INFO/FATA 文本（colima 把日志写到 stderr）。
 * 停止状态各版本措辞不同，统一按「不处于 running」处理。
 */
export const parseColimaStatus = (
  text: string
): { running: boolean; runtime: string | null; arch: string | null } => {
  const running = /colima is running/i.test(text)
  return {
    running,
    runtime: /runtime:\s*(\S+)/i.exec(text)?.[1] ?? null,
    arch: /arch:\s*(\S+)/i.exec(text)?.[1] ?? null,
  }
}

/** colima 明确「没在运行」时的措辞，属于正常状态而非故障。 */
const COLIMA_STOPPED_PATTERN =
  /colima is not running|no instance found|not running/i

export type DockerCli = ReturnType<typeof createDockerCli>

/**
 * docker/colima 执行层。run 与 cache 都可注入：
 * 测试用受控替身，不真的调 docker，也不共享全局缓存。
 */
export const createDockerCli = (
  options: { run?: DockerCommandRunner; cache?: DockerCache } = {}
) => {
  const run = options.run ?? execCommand
  const cache = options.cache ?? cached

  /** 依次尝试 PATH 与常见安装目录；只有全部 ENOENT 才判定未安装。 */
  const runCommand = async (
    command: string,
    args: string[],
    timeoutMs: number
  ): Promise<CommandOutput> => {
    const candidates = commandCandidates(command)
    let lastError: unknown = null
    for (const candidate of candidates) {
      try {
        return await run(candidate, args, { timeoutMs })
      } catch (error) {
        lastError = error
        if (error instanceof DockerCommandError) {
          if (error.kind !== "not_installed") throw error
        } else if ((error as { code?: unknown } | null)?.code !== "ENOENT") {
          throw toCommandError(candidate, error, timeoutMs)
        }
      }
    }
    throw toCommandError(candidates[0] ?? command, lastError, timeoutMs)
  }

  const docker = (args: string[], timeoutMs: number): Promise<CommandOutput> =>
    runCommand("docker", args, timeoutMs)

  const colima = (args: string[], timeoutMs: number): Promise<CommandOutput> =>
    runCommand("colima", args, timeoutMs)

  const containers = (): Promise<CommandOutput> =>
    docker(["ps", "-a", "--format", "json"], TIMEOUT.list)

  /** 容器标识会被拼进参数，先挡住非法值，避免被当成 docker 的选项。 */
  const assertContainerId = (containerId: string): void => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(containerId)) {
      throw new DockerCommandError(
        "invalid_input",
        "容器标识包含非法字符，请重新读取容器列表。"
      )
    }
  }

  const listContainers = (): Promise<DockerContainer[]> =>
    cache("docker:containers", TTL.containers, async () =>
      parseContainers((await containers()).stdout)
    )

  const listImages = (): Promise<DockerImage[]> =>
    cache("docker:images", TTL.images, async () =>
      parseImages(
        (await docker(["images", "--format", "json"], TIMEOUT.list)).stdout
      )
    )

  const listNetworks = (): Promise<DockerNetwork[]> =>
    cache("docker:networks", TTL.networks, async () => {
      const [listed, rawContainers] = await Promise.all([
        docker(["network", "ls", "--format", "json"], TIMEOUT.list),
        containers(),
      ])
      const counts = new Map<string, number>()
      for (const names of parseContainerNetworks(rawContainers.stdout)) {
        for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
      }
      return parseNetworks(listed.stdout).map((network) => ({
        ...network,
        containers: counts.get(network.name) ?? counts.get(network.id) ?? 0,
      }))
    })

  const listVolumes = (): Promise<DockerVolume[]> =>
    cache("docker:volumes", TTL.volumes, async () => {
      const [listed, rawContainers] = await Promise.all([
        docker(["volume", "ls", "--format", "json"], TIMEOUT.list),
        containers(),
      ])
      const entries = parseJsonLines(listed.stdout).map(asRecord)
      const names = entries
        .map((item) => asText(item.Name))
        .filter(isValidVolumeName)
      const inspected = new Map<
        string,
        { mountpoint: string; createdAt: number | null; driver: string }
      >()
      // 卷多时分批 inspect，保证每个卷都有挂载点信息而不是被悄悄丢掉。
      for (let index = 0; index < names.length; index += VOLUME_INSPECT_CHUNK) {
        const chunk = names.slice(index, index + VOLUME_INSPECT_CHUNK)
        const result = await docker(
          ["volume", "inspect", ...chunk],
          TIMEOUT.list
        )
        for (const [name, detail] of parseVolumeInspections(result.stdout)) {
          inspected.set(name, detail)
        }
      }
      const used = new Set<string>()
      for (const container of parseContainers(rawContainers.stdout)) {
        for (const mount of container.mounts) {
          if (mount.type === "volume") used.add(mount.source)
        }
      }
      return names.map((name) => {
        const ls = entries.find((item) => asText(item.Name) === name) ?? {}
        const detail = inspected.get(name)
        return {
          name,
          driver: detail?.driver || asText(ls.Driver) || "local",
          mountpoint: detail?.mountpoint ?? "",
          createdAt: detail?.createdAt ?? null,
          sizeBytes: parseDockerSize(asText(ls.Size)),
          inUse: used.has(name),
        }
      })
    })

  const getContainerLogs = async (
    containerId: string,
    options: { tail?: number; since?: number } = {}
  ): Promise<DockerContainerLogsResponse> => {
    assertContainerId(containerId)
    const tail = options.tail ?? 200
    const args = ["logs", "--tail", String(tail)]
    if (options.since !== undefined) args.push("--since", String(options.since))
    args.push(containerId)
    // 拒绝非法入参也要走 rejected promise，调用方 await 时行为一致。
    const { stdout, stderr } = await docker(args, TIMEOUT.logs)
    // docker 把容器 stderr 写到自己的 stderr，两边合起来才是完整日志。
    const lines = `${stdout}${stderr}`
      .split("\n")
      .filter((line, index, all) => line.length > 0 || index < all.length - 1)
    return {
      containerId,
      lines,
      // 行数正好等于上限时无法区分是否被截断，按可能截断标记。
      truncated: lines.length >= tail,
      fetchedAt: Date.now(),
    }
  }

  const getInfo = (): Promise<DockerInfo> =>
    cache("docker:info", TTL.info, async () =>
      parseInfo(
        (await docker(["info", "--format", "{{json .}}"], TIMEOUT.quick)).stdout
      )
    )

  const getVersion = (): Promise<string> =>
    cache("docker:version", TTL.version, async () =>
      parseVersion(
        (await docker(["version", "--format", "{{json .}}"], TIMEOUT.quick))
          .stdout
      )
    )

  const getColimaStatus = async (): Promise<DockerColimaStatus> => {
    const checkedAt = Date.now()
    let output = ""
    try {
      const result = await colima(["status"], TIMEOUT.quick)
      output = `${result.stdout}\n${result.stderr}`
    } catch (error) {
      if (
        !(error instanceof DockerCommandError) ||
        error.kind === "not_installed"
      ) {
        throw error
      }
      // colima status 在「未运行时」以非 0 退出，这是状态而不是故障。
      if (
        error.kind !== "failed" ||
        !COLIMA_STOPPED_PATTERN.test(error.detail)
      ) {
        throw error
      }
      return {
        installed: true,
        running: false,
        status: "colima 未运行",
        runtime: null,
        arch: null,
        cpus: null,
        memoryBytes: null,
        diskBytes: null,
        checkedAt,
      }
    }
    const parsed = parseColimaStatus(output)
    if (!parsed.running) {
      return {
        installed: true,
        running: false,
        status: "colima 未运行",
        runtime: null,
        arch: null,
        cpus: null,
        memoryBytes: null,
        diskBytes: null,
        checkedAt,
      }
    }
    return {
      installed: true,
      running: true,
      status: "colima 运行中",
      runtime: parsed.runtime,
      arch: parsed.arch,
      // status 文本不提供资源配额，需要这些数字时改用 colima list。
      cpus: null,
      memoryBytes: null,
      diskBytes: null,
      checkedAt,
    }
  }

  const startColima = async (): Promise<string> => {
    const result = await colima(["start"], TIMEOUT.colimaStart)
    return (
      firstMeaningfulLine(`${result.stdout}\n${result.stderr}`) ??
      "colima 已启动"
    )
  }

  const stopColima = async (): Promise<string> => {
    const result = await colima(["stop"], TIMEOUT.colimaStop)
    return (
      firstMeaningfulLine(`${result.stdout}\n${result.stderr}`) ??
      "colima 已停止"
    )
  }

  return {
    listContainers,
    listImages,
    listVolumes,
    listNetworks,
    getContainerLogs,
    getInfo,
    getVersion,
    getColimaStatus,
    startColima,
    stopColima,
  }
}

/** 生产使用的默认执行层实例。 */
export const dockerCli = createDockerCli()
