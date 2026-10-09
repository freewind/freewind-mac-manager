import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const MAX_BUFFER = 16 * 1024 * 1024

/** 从 lsof 的 NAME 列取出本地端口，形如 `127.0.0.1:5173` 或 `*:3000`。 */
export const parseLocalPort = (name: string): number | null => {
  const match = /:(\d+)(?:\s|$|->)/.exec(name)
  if (!match) {
    return null
  }
  const port = Number(match[1])
  return Number.isInteger(port) && port > 0 ? port : null
}

/**
 * 解析 `lsof -nP -iTCP` 输出为 pid → 本地端口集合。
 *
 * 只保留监听或已建立的 TCP 连接上的本地端口；浏览器那种随机高端口也会带上，
 * 排序后取前几个展示。
 */
export const parseLsofOutput = (output: string): Map<number, number[]> => {
  const result = new Map<number, Set<number>>()

  for (const line of output.split("\n").slice(1)) {
    const columns = line.split(/\s+/)
    if (columns.length < 9) {
      continue
    }
    const pid = Number(columns[1])
    if (!Number.isInteger(pid) || pid <= 0) {
      continue
    }

    const name = columns.slice(8).join(" ")
    const port = parseLocalPort(name)
    if (port === null) {
      continue
    }

    const ports = result.get(pid) ?? new Set<number>()
    ports.add(port)
    result.set(pid, ports)
  }

  return new Map(
    [...result.entries()].map(([pid, ports]) => [pid, [...ports].sort((a, b) => a - b)])
  )
}

/** 批量取若干进程当前占用的本地端口（一次 lsof 调用）。 */
export const snapshotPorts = async (pids: number[]): Promise<Map<number, number[]>> => {
  const targets = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 0)
  if (targets.length === 0) {
    return new Map()
  }

  try {
    const { stdout } = await execFileAsync(
      "/usr/sbin/lsof",
      ["-nP", "-iTCP", "-a", "-p", targets.join(",")],
      { maxBuffer: MAX_BUFFER }
    )
    return parseLsofOutput(stdout)
  } catch {
    // lsof 在没有任何匹配连接时以非 0 退出，这里按“没有端口”处理。
    return new Map()
  }
}
