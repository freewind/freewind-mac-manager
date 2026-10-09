import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const MAX_BUFFER = 32 * 1024 * 1024

export type ProcessTraffic = {
  pid: number
  name: string
  bytesIn: number
  bytesOut: number
}

/**
 * 解析一行 nettop 输出。数据行形如：
 *
 *     Paseo Helper.98773                 3602184           256291
 *
 * 进程名可能含空格，因此从行尾取两个数值，其余部分是 `名称.pid`。
 */
export const parseNettopLine = (line: string): ProcessTraffic | null => {
  const tokens = line.split(/[\s\t]+/).filter((token) => token.length > 0)
  if (tokens.length < 3) {
    return null
  }

  const bytesOut = Number(tokens[tokens.length - 1])
  const bytesIn = Number(tokens[tokens.length - 2])
  if (!Number.isFinite(bytesIn) || !Number.isFinite(bytesOut)) {
    return null
  }

  const identifier = tokens.slice(0, -2).join(" ")
  const separator = identifier.lastIndexOf(".")
  if (separator <= 0) {
    return null
  }

  const pid = Number(identifier.slice(separator + 1))
  if (!Number.isInteger(pid) || pid <= 0) {
    return null
  }

  return {
    pid,
    name: identifier.slice(0, separator),
    bytesIn,
    bytesOut,
  }
}

export const parseNettopOutput = (output: string): ProcessTraffic[] =>
  output
    .split("\n")
    .map(parseNettopLine)
    .filter((item): item is ProcessTraffic => item !== null)

/**
 * 按进程取一次累计流量快照。
 *
 * 数据来自系统自带的 nettop：它以 Apple 私有 entitlement 读内核统计。
 * 本服务不申请任何 entitlement，只把它当子进程调用并解析输出。
 */
export const snapshotTraffic = async (): Promise<ProcessTraffic[]> => {
  const { stdout } = await execFileAsync(
    "/usr/bin/nettop",
    ["-l", "1", "-P", "-x", "-J", "bytes_in,bytes_out", "-n"],
    { maxBuffer: MAX_BUFFER }
  )
  return parseNettopOutput(stdout)
}
