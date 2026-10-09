import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { runCommand } from "@server/common/collect"

/**
 * frpc 的 launchd 侧信息。
 *
 * 只硬编码标签这一个入口，其余路径与运行态都从它的 plist 实际读出来，
 * 免得多处硬编码后在换机器或改安装位置时对不上。
 */
export const LAUNCHD_LABEL = "com.pengli.frpc-xianyu"

const PLIST_PATH = path.join(
  os.homedir(),
  "Library/LaunchAgents",
  `${LAUNCHD_LABEL}.plist`
)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export type FrpcProgram = {
  /** frpc 可执行文件 */
  binaryPath: string
  /** plist 里 -c 指定的配置文件 */
  configPath: string
}

/** 从 plist 里取出 frpc 可执行文件与配置路径。 */
export const readProgram = async (): Promise<FrpcProgram> => {
  if (!existsSync(PLIST_PATH)) {
    throw new Error(`找不到 launchd 配置：${PLIST_PATH}`)
  }
  const text = await runCommand("/usr/bin/plutil", [
    "-convert",
    "json",
    "-o",
    "-",
    PLIST_PATH,
  ])
  const json: unknown = JSON.parse(text)
  const argumentsList =
    isRecord(json) && Array.isArray(json.ProgramArguments)
      ? json.ProgramArguments.filter(
          (item): item is string => typeof item === "string"
        )
      : []
  const binaryPath = argumentsList[0] ?? ""
  const flagIndex = argumentsList.indexOf("-c")
  const configPath = flagIndex >= 0 ? (argumentsList[flagIndex + 1] ?? "") : ""
  if (!binaryPath || !configPath) {
    throw new Error(`${PLIST_PATH} 缺少 frpc 可执行文件或 -c 配置路径`)
  }
  return { binaryPath, configPath }
}

export type FrpcRuntime = {
  state: "running" | "stopped"
  pid: number | null
  startedAt: number | null
}

/** ps 的 lstart 给出进程启动时刻；launchctl 不提供这个信息。 */
const readStartedAt = async (pid: number): Promise<number | null> => {
  try {
    const text = await runCommand("/bin/ps", [
      "-o",
      "lstart=",
      "-p",
      String(pid),
    ])
    const at = Date.parse(text.trim())
    return Number.isFinite(at) ? Math.round(at / 1000) : null
  } catch {
    return null
  }
}

/** 读运行态；服务未加载或未启动时按「已停止」处理。 */
export const readRuntime = async (): Promise<FrpcRuntime> => {
  const domain = `gui/${process.getuid?.() ?? 0}/${LAUNCHD_LABEL}`
  let text: string
  try {
    text = await runCommand("/bin/launchctl", ["print", domain])
  } catch {
    return { state: "stopped", pid: null, startedAt: null }
  }
  const pid = Number(/^\s*pid = (\d+)$/m.exec(text)?.[1] ?? "")
  const validPid = Number.isInteger(pid) && pid > 0 ? pid : null
  return {
    state: /^\s*state = running$/m.test(text) ? "running" : "stopped",
    pid: validPid,
    startedAt: validPid === null ? null : await readStartedAt(validPid),
  }
}
