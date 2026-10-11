import { execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { PublicOperationError } from "@server/common/public-error"
import { CADDY_BACKUP_DIR } from "@server/env"
import type {
  CaddyApplyResult,
  CaddyApplyStatus,
  CaddyRule,
  TaskProgress,
} from "@shared/api-contract"
import {
  assertCaddyApplyReady,
  type CaddyProbes,
  type CaddyTargets,
  defaultCaddyProbes,
  defaultCaddyTargets,
} from "./service"
import { type CaddyApplyRecord, type CaddyStore, getCaddyStore } from "./store"

/**
 * 把数据库里的规则可靠地应用到真实 Caddy。
 *
 * 顺序固定：预检 → 备份 → 原子写 → 平滑加载 → 核实运行配置 → 记录。
 * 预检阶段失败不留任何副作用；写入之后的失败必须区分「失败」与「结果未知」，
 * 不允许把没核实到的结果报成成功，也不允许自动重做一次危险动作。
 */

const VALIDATE_TIMEOUT_MS = 15_000
const RELOAD_TIMEOUT_MS = 30_000
const VERIFY_TIMEOUT_MS = 5_000
const COMMAND_MAX_BUFFER = 1024 * 1024

/** 备份保留份数：再多也只是占磁盘，留最近 20 次足够回退。 */
const BACKUP_KEEP = 20

/** 外部命令结果；超时与被信号杀死要单独标出来，不能当作普通失败。 */
export type CaddyCommandResult = {
  ok: boolean
  timedOut: boolean
  firstLine: string
}

export type CaddyCommands = {
  validate: (configFile: string) => Promise<CaddyCommandResult>
  reload: (configFile: string) => Promise<CaddyCommandResult>
}

export type CaddyApplyOutcome = {
  result: CaddyApplyResult
  message: string
  /**
   * 本次应用的真实终态。
   * unknown 表示文件已写入但运行配置无法核实，上层不得报成功，也不得自动重做。
   */
  status: CaddyApplyStatus
}

/** reload 超时或被信号杀死：文件已写入，但运行配置是否生效无法确认。 */
export class CaddyUnknownResultError extends Error {
  constructor(
    readonly outcome: CaddyApplyOutcome,
    message: string
  ) {
    super(message)
    this.name = "CaddyUnknownResultError"
  }
}

export type CaddyApplyOptions = {
  targets?: CaddyTargets
  probes?: CaddyProbes
  commands?: CaddyCommands
  /** 读取运行中的配置 JSON；默认走管理接口，测试注入替身。 */
  readRunningConfig?: (adminUrl: string) => Promise<unknown>
  store?: CaddyStore
  /** 备份目录；默认 data/caddy-backups，测试指向临时目录。 */
  backupDir?: string
  /** 要应用的目标规则；省略时用数据库当前规则。 */
  rules?: CaddyRule[]
  /** 客户端读到的指纹；不符时抛 409。 */
  expectedSignature?: string
  report?: (progress: TaskProgress) => void
}

const sha256 = (text: string): string =>
  createHash("sha256").update(text).digest("hex")

const runCaddy = (
  binaryPath: string,
  args: string[],
  timeout: number
): Promise<CaddyCommandResult> =>
  new Promise((resolve) => {
    execFile(
      binaryPath,
      args,
      { timeout, maxBuffer: COMMAND_MAX_BUFFER },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ ok: true, timedOut: false, firstLine: "" })
          return
        }
        const killed = (error as { killed?: boolean }).killed === true
        const signal = (error as { signal?: string | null }).signal ?? null
        resolve({
          ok: false,
          timedOut: killed || signal !== null,
          firstLine: firstOutputLine(stderr, stdout),
        })
      }
    )
  })

/** 报错可能很长，只留首行并截断；消息里不回传整份配置。 */
const firstOutputLine = (stderr: string, stdout: string): string => {
  for (const text of [stderr, stdout]) {
    for (const raw of text.split("\n")) {
      const line = raw.trim()
      if (line.length > 0) return line.slice(0, 300)
    }
  }
  return "caddy 未输出原因"
}

export const defaultCaddyCommands = (targets: CaddyTargets): CaddyCommands => ({
  validate: (configFile) =>
    runCaddy(
      targets.binaryPath,
      ["validate", "--config", configFile, "--adapter", "caddyfile"],
      VALIDATE_TIMEOUT_MS
    ),
  reload: (configFile) =>
    runCaddy(
      targets.binaryPath,
      ["reload", "--config", configFile, "--adapter", "caddyfile"],
      RELOAD_TIMEOUT_MS
    ),
})

/** 管理接口在 `admin off` 时连不上；这里只读，不尝试开启它。 */
const fetchRunningConfig = async (adminUrl: string): Promise<unknown> => {
  const response = await fetch(`${adminUrl.replace(/\/+$/, "")}/config/`, {
    signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`读取运行配置失败（HTTP ${response.status}）`)
  }
  return response.json()
}

const VERIFY_KEYS = ["dial", "host", "path"] as const
type VerifyKey = (typeof VERIFY_KEYS)[number]
type CaddyRunningValues = Record<VerifyKey, Set<string>>

/** 上游、域名与路径可能藏在任意层，递归收集全部值。 */
const collectRunningValues = (
  node: unknown,
  values: CaddyRunningValues
): void => {
  if (Array.isArray(node)) {
    for (const item of node) collectRunningValues(item, values)
    return
  }
  if (typeof node !== "object" || node === null) return
  for (const [key, value] of Object.entries(node)) {
    if ((VERIFY_KEYS as readonly string[]).includes(key)) {
      const items = Array.isArray(value) ? value : [value]
      for (const item of items) {
        if (typeof item === "string") values[key as VerifyKey].add(item)
      }
    }
    collectRunningValues(value, values)
  }
}

const readRunningValues = (node: unknown): CaddyRunningValues => {
  const values: CaddyRunningValues = {
    dial: new Set(),
    host: new Set(),
    path: new Set(),
  }
  collectRunningValues(node, values)
  return values
}

/** 运行配置里缺哪几条启用规则的目标；全部命中才允许报成功。 */
const missingTargets = (
  rules: CaddyRule[],
  values: CaddyRunningValues
): string[] => {
  const missing: string[] = []
  for (const rule of rules.filter((item) => item.enabled)) {
    if (!values.dial.has(rule.upstream)) missing.push(`上游 ${rule.upstream}`)
    if (
      rule.matchKind === "host" &&
      rule.host !== null &&
      !values.host.has(rule.host)
    ) {
      missing.push(`域名 ${rule.host}`)
    }
    if (
      rule.matchKind === "path" &&
      rule.pathPrefix !== null &&
      !values.path.has(rule.pathPrefix)
    ) {
      missing.push(`路径 ${rule.pathPrefix}`)
    }
  }
  return missing
}

const runningFingerprintOf = (values: CaddyRunningValues): string =>
  sha256(
    JSON.stringify({
      dial: [...values.dial].sort(),
      host: [...values.host].sort(),
      path: [...values.path].sort(),
    })
  )

const pad = (value: number): string => String(value).padStart(2, "0")

const backupStamp = (date: Date): string =>
  [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("")

/** 备份：目录不存在就建；超过保留份数时按文件名（即时间）删最旧的。 */
const writeBackup = async (
  backupDir: string,
  text: string
): Promise<string> => {
  await mkdir(backupDir, { recursive: true })
  const file = path.join(backupDir, `${backupStamp(new Date())}-Caddyfile`)
  await writeFile(file, text, "utf8")
  try {
    const entries = (await readdir(backupDir))
      .filter((name) => name.endsWith("-Caddyfile"))
      .sort()
    for (const name of entries.slice(
      0,
      Math.max(0, entries.length - BACKUP_KEEP)
    )) {
      await rm(path.join(backupDir, name), { force: true })
    }
  } catch {
    // 清理旧备份失败不影响本次应用，留给用户手工处理。
  }
  return file
}

/**
 * 同目录内先写临时文件再 rename：正式路径上不会出现半截文件，
 * 权限位与原文件一致（caddy 以普通用户读它，权限不能变）。
 */
const atomicWrite = async (target: string, content: string): Promise<void> => {
  const directory = path.dirname(target)
  const temp = path.join(
    directory,
    `.${path.basename(target)}.${randomUUID().slice(0, 8)}.tmp`
  )
  try {
    const mode = (await stat(target)).mode & 0o7777
    await writeFile(temp, content, { encoding: "utf8", mode })
    await chmod(temp, mode)
    await rename(temp, target)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

/** 用备份内容把正式文件还原（同样走原子写）。 */
const restoreFromBackup = async (
  target: string,
  backupFile: string
): Promise<void> => {
  await atomicWrite(target, await readFile(backupFile, "utf8"))
}

/**
 * 校验候选配置：写到临时文件跑 `caddy validate`，无论结果如何都删掉临时文件。
 * validate 失败属于入参问题（400），此时正式文件一个字节都没动。
 */
const validateCandidate = async (
  commands: CaddyCommands,
  configFile: string,
  candidate: string
): Promise<void> => {
  const temp = path.join(
    path.dirname(configFile),
    `.${path.basename(configFile)}.${randomUUID().slice(0, 8)}.validate.tmp`
  )
  try {
    await writeFile(temp, candidate, "utf8")
    const validated = await commands.validate(temp)
    if (!validated.ok) {
      throw new PublicOperationError(
        400,
        `配置校验未通过：${validated.firstLine}`
      )
    }
  } finally {
    await rm(temp, { force: true })
  }
}

const noProgress = (): void => {}

export const applyCaddyRules = async (
  options: CaddyApplyOptions = {}
): Promise<CaddyApplyOutcome> => {
  const targets = options.targets ?? defaultCaddyTargets()
  const probes = options.probes ?? defaultCaddyProbes
  const commands = options.commands ?? defaultCaddyCommands(targets)
  const readRunningConfig = options.readRunningConfig ?? fetchRunningConfig
  const store = options.store ?? getCaddyStore()
  const backupDir = options.backupDir ?? CADDY_BACKUP_DIR
  const report = options.report ?? noProgress
  const rules = options.rules ?? store.listRules()

  /** 记录一次应用；无论成败都留档，页面据此判断版本与是否需要恢复。 */
  const record = (
    status: CaddyApplyStatus,
    message: string,
    verified: boolean,
    runningFingerprint: string | null,
    configText: string,
    backupFile: string | null
  ): CaddyApplyResult => {
    const entry: CaddyApplyRecord = {
      id: randomUUID(),
      appliedAt: Math.floor(Date.now() / 1000),
      status,
      message,
      rules,
      generatedText: configText,
      configFingerprint: sha256(configText),
      runningFingerprint,
    }
    store.insertApplyRecord(entry)
    return {
      message,
      versionId: entry.id,
      appliedAt: entry.appliedAt,
      ruleCount: rules.length,
      verified,
      backupFile,
    }
  }

  const progress = (done: number, stage: string, target: string | null) =>
    report({
      done,
      total: 5,
      bytesDone: null,
      bytesTotal: null,
      stage,
      currentTarget: target,
    })

  // 1 预检：到这一步为止失败都不写文件、不留记录。
  progress(0, "校验配置", targets.configFile)
  const ready = await assertCaddyApplyReady(
    targets,
    probes,
    store,
    options.expectedSignature,
    rules
  )
  await validateCandidate(commands, targets.configFile, ready.candidate)

  // 2 备份：写不了备份就绝不继续动正式文件。
  progress(1, "备份", backupDir)
  const backupFile = await writeBackup(backupDir, ready.text)

  // 3 原子写。
  progress(2, "写入文件", targets.configFile)
  await atomicWrite(targets.configFile, ready.candidate)

  // 4 平滑加载：失败就还原文件；超时则不还原，按结果未知处理。
  progress(3, "加载配置", targets.configFile)
  const reloaded = await commands.reload(targets.configFile)
  if (!reloaded.ok) {
    if (reloaded.timedOut) {
      const message =
        "加载配置超时或中断，无法确认是否已生效；文件未被还原，请核实运行配置后再决定是否恢复"
      const result = record(
        "unknown",
        message,
        false,
        null,
        ready.candidate,
        backupFile
      )
      progress(5, "完成", null)
      throw new CaddyUnknownResultError(
        { result, message, status: "unknown" },
        message
      )
    }
    await restoreFromBackup(targets.configFile, backupFile)
    const message = `配置未生效，文件已还原；运行中的配置仍是旧版本：${reloaded.firstLine}`
    record("failed", message, false, null, ready.candidate, backupFile)
    progress(5, "完成", null)
    throw new PublicOperationError(500, message)
  }

  // 5 核实运行配置：文件写完、加载成功，还要确认规则真的在里面。
  progress(4, "核实", targets.adminUrl)
  let runningValues: CaddyRunningValues | null = null
  try {
    runningValues = readRunningValues(await readRunningConfig(targets.adminUrl))
  } catch {
    runningValues = null
  }
  progress(5, "完成", null)

  if (runningValues === null) {
    const message =
      "配置已写入并已加载，但无法确认运行配置是否已生效；请核实后再决定是否恢复上一版本"
    const result = record(
      "unknown",
      message,
      false,
      null,
      ready.candidate,
      backupFile
    )
    return { result, message, status: "unknown" }
  }

  const missing = missingTargets(rules, runningValues)
  if (missing.length > 0) {
    const message = `文件已写入并已加载，但运行配置里未核实到全部规则（${missing.join(
      "、"
    )}），请检查或恢复上一版本`
    const result = record(
      "failed",
      message,
      false,
      // 未核实到全部规则时不留运行配置指纹：没有一份可信的「已生效」证据。
      null,
      ready.candidate,
      backupFile
    )
    return { result, message, status: "failed" }
  }

  const message = `已应用 ${rules.length} 条规则，并已在运行配置里核实`
  const result = record(
    "success",
    message,
    true,
    runningFingerprintOf(runningValues),
    ready.candidate,
    backupFile
  )
  return { result, message, status: "success" }
}
