import { execFile } from "node:child_process"
import type { ServiceDomain } from "@shared/api-contract"

const uid = (): string => String(process.getuid?.() ?? 0)

/** launchctl 的目标域：用户与全局目录都归 GUI 域，系统目录归 system 域。 */
export const targetOf = (domain: ServiceDomain): string =>
  domain === "system" ? "system" : `gui/${uid()}`

const firstMeaningfulLine = (text: string): string | null => {
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (line.length === 0) continue
    if (/^Command failed:/i.test(line)) continue
    return line.replace(/^launchctl:\s*/i, "").trim()
  }
  return null
}

/** 命令失败时优先用 stderr，其次 stdout，整理成一行可读的错误。 */
export const commandError = (
  error: unknown,
  stdout: string,
  stderr: string
): Error => {
  for (const value of [stderr, stdout]) {
    const line = firstMeaningfulLine(value)
    if (line) return new Error(line)
  }
  const message = error instanceof Error ? error.message : String(error)
  return new Error(firstMeaningfulLine(message) ?? message)
}

const run = (args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      "/bin/launchctl",
      args,
      { maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(commandError(error, stdout, stderr))
          return
        }
        resolve(stdout)
      }
    )
  })

export type ServiceRuntime = {
  loaded: boolean
  running: boolean
  pid: number | null
  lastExitCode: number | null
}

const matchNumber = (text: string, pattern: RegExp): number | null => {
  const found = pattern.exec(text)
  return found ? Number(found[1]) : null
}

/** 读取单个服务的运行状态；服务未加载时各字段为空。 */
export const readRuntime = async (
  domain: ServiceDomain,
  label: string
): Promise<ServiceRuntime> => {
  try {
    const text = await run(["print", `${targetOf(domain)}/${label}`])
    return {
      loaded: true,
      running: /^\s*state = running$/m.test(text),
      pid: matchNumber(text, /^\s*pid = (\d+)$/m),
      lastExitCode: matchNumber(text, /^\s*last exit code = (-?\d+)$/m),
    }
  } catch {
    return { loaded: false, running: false, pid: null, lastExitCode: null }
  }
}

/** 读取某个域里被 disable 的服务名集合。 */
export const readDisabledMap = async (
  domain: ServiceDomain
): Promise<Map<string, boolean>> => {
  const map = new Map<string, boolean>()
  try {
    const text = await run(["print-disabled", targetOf(domain)])
    for (const match of text.matchAll(/"([^"]+)" => (disabled|enabled)/g)) {
      map.set(match[1], match[2] === "disabled")
    }
  } catch {
    // 拿不到禁用清单时按「未禁用」处理。
  }
  return map
}

export const kickstart = (
  domain: ServiceDomain,
  label: string
): Promise<string> => run(["kickstart", `${targetOf(domain)}/${label}`])

export const kickstartRestart = (
  domain: ServiceDomain,
  label: string
): Promise<string> => run(["kickstart", "-k", `${targetOf(domain)}/${label}`])

export const terminate = (
  domain: ServiceDomain,
  label: string
): Promise<string> => run(["kill", "SIGTERM", `${targetOf(domain)}/${label}`])

export const bootstrapPlist = (
  domain: ServiceDomain,
  file: string
): Promise<string> => run(["bootstrap", targetOf(domain), file])

export const bootoutPlist = (
  domain: ServiceDomain,
  file: string
): Promise<string> => run(["bootout", targetOf(domain), file])

export const setEnabled = (
  domain: ServiceDomain,
  label: string,
  enabled: boolean
): Promise<string> =>
  run([enabled ? "enable" : "disable", `${targetOf(domain)}/${label}`])
