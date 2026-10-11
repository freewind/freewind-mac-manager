import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { PublicOperationError } from "@server/common/public-error"
import {
  CADDY_ADMIN_URL,
  CADDY_BINARY,
  CADDY_CONFIG_FILE,
  CADDY_LAUNCHD_LABEL,
} from "@server/env"
import { readRuntime } from "@server/system-services/launchctl"
import type { CaddyRulesResponse, CaddyStatus } from "@shared/api-contract"
import { type CaddyFileParse, parseCaddyfile } from "@shared/caddy-format"

/**
 * Caddy 只读现状。
 *
 * 这里只读三件事：launchd 里的进程状态、二进制版本、管理接口可达性，
 * 以及配置文件的真实内容。任何一项读不到都只降级为对应字段，不让整页失败；
 * 但配置文件读不到是例外——那意味着「规则未知」，必须报错而不是回空列表。
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

/** 进程、管理接口与配置文件的现状。 */
export const readCaddyStatus = async (
  targets: CaddyTargets = defaultCaddyTargets(),
  probes: CaddyProbes = defaultCaddyProbes
): Promise<CaddyStatus> => {
  const parsed = parseCaddyfile(await readCaddyConfigText(targets.configFile))
  return collectStatus(targets, probes, parsed)
}

/** 识别结果加上同一时刻的现状，页面据此标明数据新鲜度。 */
export const readCaddyRules = async (
  targets: CaddyTargets = defaultCaddyTargets(),
  probes: CaddyProbes = defaultCaddyProbes
): Promise<CaddyRulesResponse> => {
  const parsed = parseCaddyfile(await readCaddyConfigText(targets.configFile))
  const status = await collectStatus(targets, probes, parsed)
  return {
    status,
    rules: parsed.rules,
    unsupportedLines: parsed.unsupported.length,
    unsupportedSamples: parsed.unsupported
      .slice(0, UNSUPPORTED_SAMPLE_LIMIT)
      .map((item) => `第 ${item.line} 行：${item.text}`),
  }
}
