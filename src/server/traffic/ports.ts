import { execFile } from "node:child_process"

const MAX_BUFFER = 16 * 1024 * 1024
const BATCH_SIZE = 128
const COMMAND_TIMEOUT_MS = 5_000

export type PortSnapshotOptions = {
  onProgress?: (done: number, total: number) => void
  run?: (pids: number[]) => Promise<string>
}

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
    [...result.entries()].map(([pid, ports]) => [
      pid,
      [...ports].sort((a, b) => a - b),
    ])
  )
}

/** 每批命令有大小与时间上限，只有明确的无匹配结果可以作为空连接。 */
const runPortCommand = (pids: number[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      "/usr/sbin/lsof",
      ["-nP", "-iTCP", "-a", "-p", pids.join(",")],
      { maxBuffer: MAX_BUFFER, timeout: COMMAND_TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (error) {
          const noMatch =
            error.code === 1 &&
            !error.killed &&
            !error.signal &&
            stderr.trim() === "" &&
            stdout.trim() === ""
          if (noMatch) resolve("")
          else
            reject(
              new Error(error.killed ? "端口采集超时" : "端口采集失败", {
                cause: error,
              })
            )
          return
        }
        resolve(stdout)
      }
    )
  })

export const snapshotPorts = async (
  pids: number[],
  options: PortSnapshotOptions = {}
): Promise<Map<number, number[]>> => {
  const targets = [...new Set(pids)].filter(
    (pid) => Number.isInteger(pid) && pid > 0
  )
  const result = new Map<number, number[]>()
  if (targets.length === 0) return result
  const run = options.run ?? runPortCommand

  for (let offset = 0; offset < targets.length; offset += BATCH_SIZE) {
    const batch = targets.slice(offset, offset + BATCH_SIZE)
    const output = await run(batch)
    for (const [pid, ports] of parseLsofOutput(output)) {
      result.set(pid, ports)
    }
    options.onProgress?.(
      Math.min(offset + batch.length, targets.length),
      targets.length
    )
  }
  return result
}
