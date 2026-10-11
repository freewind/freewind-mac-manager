import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { readRuntime } from "@server/common/launchd"
import { PublicOperationError } from "@server/common/public-error"
import {
  CADDY_ADMIN_URL,
  CADDY_BINARY,
  CADDY_CONFIG_FILE,
  CADDY_LAUNCHD_LABEL,
} from "@server/env"
import type {
  CaddyExternalRule,
  CaddyRule,
  CaddyRuleChanges,
  CaddyRuleImportResult,
  CaddyRuleInput,
  CaddyRulesResponse,
  CaddyStatus,
} from "@shared/api-contract"
import {
  type CaddyFileParse,
  caddyRulesSignature,
  generateManagedRules,
  normalizeCaddyPathPrefix,
  type ParsedCaddyRule,
  parseCaddyfile,
  validateCaddyHost,
  validateCaddyPathPrefix,
  validateCaddyUpstream,
} from "@shared/caddy-format"
import { type CaddyStore, getCaddyStore } from "./store"

/**
 * Caddy 的规则管理：读现状、维护受管规则、生成受管区域文本。
 *
 * 只读的三项（launchd 进程状态、二进制版本、管理接口可达性）读不到只降级为
 * 对应字段；配置文件读不到是例外——那意味着「规则未知」，必须报错而不是
 * 回空列表。写操作只改数据库，改配置文件由应用动作负责（另一个任务）。
 */

/** 子进程与网络探测都要有硬上限：读不到也要尽快给页面一个结论。 */
const VERSION_TIMEOUT_MS = 3000
const ADMIN_TIMEOUT_MS = 2000
const COMMAND_MAX_BUFFER = 1024 * 1024

/** 无法识别行的样本上限，与契约里的 max(20) 保持一致。 */
const UNSUPPORTED_SAMPLE_LIMIT = 20

/** 本域要读的目标；测试用临时文件与受控地址替换。 */
export type CaddyTargets = {
  configFile: string
  binaryPath: string
  adminUrl: string
  launchdLabel: string
}

/** 探测能力单独成对象，测试用受控替身，不必真跑命令与网络。 */
export type CaddyProbes = {
  isProcessRunning: (label: string) => Promise<boolean>
  readVersion: (binaryPath: string) => Promise<string | null>
  isAdminReachable: (adminUrl: string) => Promise<boolean>
}

export const defaultCaddyTargets = (): CaddyTargets => ({
  configFile: CADDY_CONFIG_FILE,
  binaryPath: CADDY_BINARY,
  adminUrl: CADDY_ADMIN_URL,
  launchdLabel: CADDY_LAUNCHD_LABEL,
})

const runWithTimeout = (
  command: string,
  args: string[],
  timeout: number
): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout, maxBuffer: COMMAND_MAX_BUFFER },
      (error, stdout) => {
        if (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
          return
        }
        resolve(stdout)
      }
    )
  })

/** launchd 读不到状态时按「未运行」处理，不把异常丢给页面。 */
const probeProcessRunning = async (label: string): Promise<boolean> => {
  const runtime = await readRuntime("user", label)
  return runtime.running
}

/** 版本读不到就用 null 表示未知，不编造。 */
const probeVersion = async (binaryPath: string): Promise<string | null> => {
  try {
    const output = await runWithTimeout(
      binaryPath,
      ["version"],
      VERSION_TIMEOUT_MS
    )
    const version = output.trim().split(/\s+/)[0] ?? ""
    return version.length > 0 ? version : null
  } catch {
    return null
  }
}

/**
 * 管理接口默认是关闭的（配置文件里 admin off），连不上就是预期现状。
 * 这里只判断可达性，不尝试启用或修改它。
 */
const probeAdminReachable = async (adminUrl: string): Promise<boolean> => {
  try {
    const response = await fetch(`${adminUrl.replace(/\/+$/, "")}/config/`, {
      signal: AbortSignal.timeout(ADMIN_TIMEOUT_MS),
    })
    return response.ok
  } catch {
    return false
  }
}

export const defaultCaddyProbes: CaddyProbes = {
  isProcessRunning: probeProcessRunning,
  readVersion: probeVersion,
  isAdminReachable: probeAdminReachable,
}

const errorCode = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null
  }
  const code = (error as { code?: unknown }).code
  return typeof code === "string" ? code : null
}

/** 读配置文件原文；读不到就报错，绝不用空内容冒充「没有规则」。 */
export const readCaddyConfigText = async (file: string): Promise<string> => {
  try {
    return await readFile(file, "utf8")
  } catch (error) {
    const code = errorCode(error)
    if (code === "ENOENT") {
      throw new PublicOperationError(404, `找不到 Caddy 配置文件：${file}`)
    }
    if (code === "EACCES" || code === "EPERM") {
      throw new PublicOperationError(
        403,
        `没有权限读取 Caddy 配置文件：${file}`
      )
    }
    throw new Error(`读取 Caddy 配置文件失败：${file}`, { cause: error })
  }
}

const collectStatus = async (
  targets: CaddyTargets,
  probes: CaddyProbes,
  parsed: CaddyFileParse
): Promise<CaddyStatus> => {
  const [processRunning, version, adminReachable] = await Promise.all([
    probes.isProcessRunning(targets.launchdLabel),
    probes.readVersion(targets.binaryPath),
    probes.isAdminReachable(targets.adminUrl),
  ])
  return {
    processRunning,
    version,
    configFile: targets.configFile,
    binaryPath: targets.binaryPath,
    launchdLabel: targets.launchdLabel,
    adminUrl: targets.adminUrl,
    adminReachable,
    managedRegionPresent: parsed.managedRegion !== null,
    readAt: Date.now() / 1000,
  }
}

const toExternalRule = (rule: ParsedCaddyRule): CaddyExternalRule => ({
  id: rule.id,
  matchKind: rule.matchKind,
  host: rule.host,
  pathPrefix: rule.pathPrefix,
  stripPrefix: rule.stripPrefix,
  upstream: rule.upstream,
  line: rule.line,
})

/**
 * 文件里受管区域的内容指纹。
 *
 * 停用的规则不会写进文件，所以拿「全部规则」去比会误报漂移；这里两侧都只取
 * 会出现在文件里的部分：区域侧全是启用状态，数据库侧先滤掉停用项。
 */
const managedRegionSignature = (parsed: CaddyFileParse): string =>
  caddyRulesSignature(
    parsed.rules
      .filter((rule) => rule.origin === "managed")
      .map((rule, index) => ({
        matchKind: rule.matchKind,
        host: rule.host,
        pathPrefix: rule.pathPrefix,
        stripPrefix: rule.stripPrefix,
        upstream: rule.upstream,
        enabled: true,
        sortOrder: index,
      }))
  )

/**
 * 单条规则的转发内容是否有变。启用状态不参与：启停由 enabled / disabled
 * 两个列表单独表达，否则同一次改动会在两个列表里各出现一次。
 */
const forwardingChanged = (before: CaddyRule, after: CaddyRule): boolean =>
  caddyRulesSignature([{ ...before, enabled: true }]) !==
  caddyRulesSignature([{ ...after, enabled: true }])

/**
 * 相对上次成功应用的变化。
 *
 * enabled / disabled 只记「同一条规则被启停」，新增与删除各自单列，
 * 不重复出现在多个列表里。
 */
const buildChanges = (
  current: CaddyRule[],
  applied: CaddyRule[],
  hasApplied: boolean
): CaddyRuleChanges => {
  if (!hasApplied) {
    return {
      added: current,
      updated: [],
      removed: [],
      enabled: [],
      disabled: [],
    }
  }

  const appliedById = new Map(applied.map((rule) => [rule.id, rule]))
  const currentIds = new Set(current.map((rule) => rule.id))
  const added: CaddyRule[] = []
  const updated: { before: CaddyRule; after: CaddyRule }[] = []
  const enabled: CaddyRule[] = []
  const disabled: CaddyRule[] = []

  for (const rule of current) {
    const before = appliedById.get(rule.id)
    if (before === undefined) {
      added.push(rule)
      continue
    }
    if (forwardingChanged(before, rule)) updated.push({ before, after: rule })
    if (!before.enabled && rule.enabled) enabled.push(rule)
    if (before.enabled && !rule.enabled) disabled.push(rule)
  }

  return {
    added,
    updated,
    removed: applied.filter((rule) => !currentIds.has(rule.id)),
    enabled,
    disabled,
  }
}

/** 进程、管理接口与配置文件的现状。 */
export const readCaddyStatus = async (
  targets: CaddyTargets = defaultCaddyTargets(),
  probes: CaddyProbes = defaultCaddyProbes
): Promise<CaddyStatus> => {
  const parsed = parseCaddyfile(await readCaddyConfigText(targets.configFile))
  return collectStatus(targets, probes, parsed)
}

/** 受管规则（数据库为准）加上文件现状与变化清单，供页面与应用前预览。 */
export const readCaddyRules = async (
  targets: CaddyTargets = defaultCaddyTargets(),
  probes: CaddyProbes = defaultCaddyProbes,
  store: CaddyStore = getCaddyStore()
): Promise<CaddyRulesResponse> => {
  const parsed = parseCaddyfile(await readCaddyConfigText(targets.configFile))
  const status = await collectStatus(targets, probes, parsed)
  const rules = store.listRules()
  const externalRules = parsed.rules
    .filter((rule) => rule.origin === "external")
    .map(toExternalRule)
  const unsupportedLines = parsed.unsupported.length
  const applied = store.latestApplyRecord()
  const currentSignature = caddyRulesSignature(rules)
  const appliedSignature =
    applied === null ? null : caddyRulesSignature(applied.rules)

  // 三种情况都不能安全重写配置，必须让页面说清是哪种。
  const blockedReason =
    parsed.managedRegion === null
      ? "现有配置尚未接管，应用会与手工规则重复"
      : unsupportedLines > 0
        ? "配置文件里有无法识别的行，应用可能覆盖手工配置"
        : externalRules.length > 0
          ? "配置文件里还有尚未接管的规则"
          : null

  return {
    status,
    rules,
    externalRules,
    unsupportedLines,
    unsupportedSamples: parsed.unsupported
      .slice(0, UNSUPPORTED_SAMPLE_LIMIT)
      .map((item) => `第 ${item.line} 行：${item.text}`),
    appliedSignature,
    appliedAt: applied?.appliedAt ?? null,
    currentSignature,
    hasUnappliedChanges:
      applied === null
        ? rules.length > 0
        : currentSignature !== appliedSignature,
    managedRegionDrifted:
      parsed.managedRegion !== null &&
      managedRegionSignature(parsed) !==
        caddyRulesSignature(rules.filter((rule) => rule.enabled)),
    changes: buildChanges(rules, applied?.rules ?? [], applied !== null),
    previewText: generateManagedRules(rules),
    writable: blockedReason === null,
    blockedReason,
  }
}

/** 字段级校验与跨字段一致性；返回归一化后的入参。 */
const normalizeRuleInput = (input: CaddyRuleInput): CaddyRuleInput => {
  if (input.matchKind === "host") {
    if (input.host === null || input.host.length === 0) {
      throw new PublicOperationError(400, "host 匹配必须填写域名")
    }
    if (input.pathPrefix !== null) {
      throw new PublicOperationError(400, "host 匹配不能同时填路径前缀")
    }
    const error = validateCaddyHost(input.host)
    if (error !== null) throw new PublicOperationError(400, error)
  } else {
    if (input.pathPrefix === null || input.pathPrefix.length === 0) {
      throw new PublicOperationError(400, "路径匹配必须填写路径前缀")
    }
    if (input.host !== null) {
      throw new PublicOperationError(400, "路径匹配不能同时填域名")
    }
    const error = validateCaddyPathPrefix(input.pathPrefix)
    if (error !== null) throw new PublicOperationError(400, error)
  }

  const upstreamError = validateCaddyUpstream(input.upstream)
  if (upstreamError !== null) throw new PublicOperationError(400, upstreamError)

  return {
    ...input,
    stripPrefix: input.matchKind === "path" ? input.stripPrefix : false,
  }
}

/** 同一类型下匹配条件必须唯一；修改时排除自身。 */
const ensureUniqueMatch = (
  store: CaddyStore,
  input: CaddyRuleInput,
  excludeId: string | null
): void => {
  const duplicate = store.findRuleByMatch(
    input.matchKind,
    input.host,
    input.pathPrefix,
    excludeId
  )
  if (duplicate !== null) {
    throw new PublicOperationError(
      409,
      `已有规则「${duplicate.name}」使用同样的匹配条件`
    )
  }
}

/** 归一化后一条前缀是另一条的前缀就算重叠；`/` 与任何路径都重叠。 */
const prefixesOverlap = (left: string, right: string): boolean => {
  if (left === "/" || right === "/") return true
  return (
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  )
}

/** 路径规则之间不能互相遮蔽，否则真正的转发结果与页面展示不一致。 */
const ensureNoOverlap = (
  store: CaddyStore,
  input: CaddyRuleInput,
  excludeId: string | null
): void => {
  if (input.matchKind !== "path" || input.pathPrefix === null) return
  const candidate = normalizeCaddyPathPrefix(input.pathPrefix)
  for (const other of store.listRules()) {
    if (other.id === excludeId) continue
    if (other.matchKind !== "path" || other.pathPrefix === null) continue
    const existing = normalizeCaddyPathPrefix(other.pathPrefix)
    if (prefixesOverlap(candidate, existing)) {
      throw new PublicOperationError(
        409,
        `路径前缀与规则「${other.name}」（${other.pathPrefix}）重叠`
      )
    }
  }
}

/** 新增规则：只写数据库，配置文件要另行应用。 */
export const createCaddyRule = (
  input: CaddyRuleInput,
  store: CaddyStore = getCaddyStore()
): CaddyRule => {
  const normalized = normalizeRuleInput(input)
  ensureUniqueMatch(store, normalized, null)
  ensureNoOverlap(store, normalized, null)
  return store.createRule(normalized)
}

/** 修改规则：目标不存在先报 404，再判入参。 */
export const updateCaddyRule = (
  id: string,
  input: CaddyRuleInput,
  store: CaddyStore = getCaddyStore()
): CaddyRule => {
  if (store.findRule(id) === null) {
    throw new PublicOperationError(404, "规则不存在")
  }
  const normalized = normalizeRuleInput(input)
  ensureUniqueMatch(store, normalized, id)
  ensureNoOverlap(store, normalized, id)
  const updated = store.updateRule(id, normalized)
  if (updated === null) throw new PublicOperationError(404, "规则不存在")
  return updated
}

export const deleteCaddyRule = (
  id: string,
  store: CaddyStore = getCaddyStore()
): void => {
  if (!store.deleteRule(id)) {
    throw new PublicOperationError(404, "规则不存在")
  }
}

/**
 * 把文件里尚未接管的规则纳入管理：只写数据库，配置文件一个字节都不动。
 * 入参文件规则的字段仍要过同一套校验，避免把无效目标带进数据库。
 */
export const importCaddyRulesFromFile = async (
  targets: CaddyTargets = defaultCaddyTargets(),
  store: CaddyStore = getCaddyStore()
): Promise<CaddyRuleImportResult> => {
  const parsed = parseCaddyfile(await readCaddyConfigText(targets.configFile))
  const inputs: CaddyRuleInput[] = parsed.rules
    .filter((rule) => rule.origin === "external")
    .map((rule) => {
      const label =
        rule.matchKind === "host" ? (rule.host ?? "") : (rule.pathPrefix ?? "")
      try {
        return normalizeRuleInput({
          name: label,
          note: "",
          matchKind: rule.matchKind,
          host: rule.host,
          pathPrefix: rule.pathPrefix,
          stripPrefix: rule.stripPrefix,
          upstream: rule.upstream,
          enabled: true,
        })
      } catch (error) {
        const reason =
          error instanceof PublicOperationError ? error.message : "入参无效"
        throw new PublicOperationError(
          400,
          `第 ${rule.line} 行的规则无法导入：${reason}`
        )
      }
    })
  return store.importRules(inputs)
}
