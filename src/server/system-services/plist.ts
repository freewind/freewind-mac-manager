import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"

type PlistJson = Record<string, unknown>

const runText = (command: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }
      resolve(stdout)
    })
  })

/** plist 原文（展示用）。 */
export const readPlistText = (file: string): Promise<string> =>
  readFile(file, "utf8")

/**
 * 用系统自带的 plutil 把 plist 转成 JSON。
 * 不引第三方 plist 解析库，二进制与 XML 两种格式都能处理。
 */
export const readPlistJson = async (file: string): Promise<PlistJson> => {
  const text = await runText("/usr/bin/plutil", [
    "-convert",
    "json",
    "-o",
    "-",
    file,
  ])
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path.basename(file)} 不是合法的 plist 字典`)
  }
  return parsed as PlistJson
}

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null

const asNumber = (value: unknown): number | null =>
  typeof value === "number" ? value : null

const asBoolean = (value: unknown): boolean => value === true

/** plist 里 ProgramArguments 的第一项即程序路径；缺省时退回 Program。 */
const programOf = (json: PlistJson): { program: string; args: string[] } => {
  const argumentList = Array.isArray(json.ProgramArguments)
    ? json.ProgramArguments.filter(
        (item): item is string => typeof item === "string"
      )
    : []
  if (argumentList.length > 0) {
    return { program: argumentList[0], args: argumentList.slice(1) }
  }
  const program = asString(json.Program) ?? ""
  return { program, args: [] }
}

/** plist 字典 → 界面需要的字段。 */
export type PlistFields = {
  label: string | null
  program: string
  args: string[]
  runAtLoad: boolean
  keepAlive: boolean
  startInterval: number | null
  workingDirectory: string | null
  stdoutPath: string | null
  stderrPath: string | null
  environment: Record<string, string>
  processType: string | null
  throttleInterval: number | null
}

export const toPlistFields = (json: PlistJson): PlistFields => {
  const { program, args } = programOf(json)
  const environment: Record<string, string> = {}
  if (
    typeof json.EnvironmentVariables === "object" &&
    json.EnvironmentVariables !== null &&
    !Array.isArray(json.EnvironmentVariables)
  ) {
    for (const [key, value] of Object.entries(
      json.EnvironmentVariables as Record<string, unknown>
    )) {
      if (typeof value === "string") environment[key] = value
    }
  }
  return {
    label: asString(json.Label),
    program,
    args,
    runAtLoad: asBoolean(json.RunAtLoad),
    // KeepAlive 也可能是字典形式，只要不是 false 就当作会拉起。
    keepAlive: json.KeepAlive !== undefined && json.KeepAlive !== false,
    startInterval: asNumber(json.StartInterval),
    workingDirectory: asString(json.WorkingDirectory),
    stdoutPath: asString(json.StandardOutPath),
    stderrPath: asString(json.StandardErrorPath),
    environment,
    processType: asString(json.ProcessType),
    throttleInterval: asNumber(json.ThrottleInterval),
  }
}
