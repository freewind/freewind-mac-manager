import path from "node:path"
import {
  cached,
  collectListeningPorts,
  runCommand,
} from "@server/common/collect"
import type {
  ProcessEntry,
  ProcessKind,
  ProcessState,
} from "@shared/api-contract"

/** 进程列表只缓存很短一瞬：页面按 2 秒轮询，重复请求不必各自再跑一遍 ps。 */
const PROCESS_TTL = 1_500
const THREAD_TTL = 5_000
const PORT_TTL = 5_000

/** 一行 `ps -axo pid=,ppid=,user=,pcpu=,rss=,stat=,etime=,args=`：前 7 列固定，命令行在最后。 */
const PS_LINE =
  /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/

/** 一行 `ps -axo pid=,comm=`：pid 在前，可执行文件路径在最后（路径可能含空格）。 */
const COMM_LINE = /^\s*(\d+)\s+(.+)$/

const STATE_BY_LETTER: Record<string, ProcessState> = {
  R: "running",
  I: "idle",
  T: "stopped",
  Z: "zombie",
}

/** `ps` 的 STAT 首字母：R 运行、I 空闲、T 停止、Z 僵尸，其余按休眠处理。 */
const stateOf = (stat: string): ProcessState =>
  STATE_BY_LETTER[stat.slice(0, 1).toUpperCase()] ?? "sleeping"

/** 由可执行文件路径与父进程猜归属，只用于图标与文案。 */
const kindOf = (
  executable: string,
  name: string,
  ppid: number
): ProcessKind => {
  if (
    name === "kernel_task" ||
    executable.startsWith("/System/Library/Kernels/")
  ) {
    return "kernel"
  }
  if (/Helper/.test(name)) return "helper"
  if (
    executable.startsWith("/Applications/") ||
    executable.startsWith("/System/Applications/")
  ) {
    return "app"
  }
  if (
    executable.startsWith("/opt/homebrew/") ||
    executable.startsWith("/usr/local/")
  ) {
    return "service"
  }
  return ppid === 1 ? "daemon" : "service"
}

/** `ps` 的 ELAPSED：`07-23:42:14`（天-时:分:秒）或 `03:42:14`、`42:14`。 */
export const parseElapsed = (text: string): number => {
  const [dayText, ...rest] = text.split("-")
  const timeText = rest.length > 0 ? rest.join("-") : dayText
  const parts = timeText.split(":").map((item) => Number(item))
  if (parts.length < 2 || parts.some((item) => !Number.isFinite(item))) {
    return 0
  }
  const seconds = parts.reduce((total, item) => total * 60 + item, 0)
  const days = rest.length > 0 ? Number(dayText) : 0
  return (Number.isFinite(days) ? days : 0) * 86400 + seconds
}

/** 线程数只能靠 `ps -axM` 的线程行统计，一次约 0.15 秒，缓存稍久。 */
const collectThreadCounts = (): Promise<Map<number, number>> =>
  cached("process-threads", THREAD_TTL, async () => {
    const output = await runCommand("/bin/ps", ["-axM", "-o", "pid="])
    const counts = new Map<number, number>()
    for (const line of output.split("\n")) {
      const tokens = line.trim().split(/\s+/)
      const pid = Number(tokens[tokens.length - 1])
      if (!Number.isInteger(pid) || pid <= 0) continue
      counts.set(pid, (counts.get(pid) ?? 0) + 1)
    }
    return counts
  })

/** 监听端口复用概览页那份 lsof 采集结果，反转成 pid → 端口。 */
const collectPortsByPid = (): Promise<Map<number, number[]>> =>
  cached("process-ports", PORT_TTL, async () => {
    const listening = await collectListeningPorts()
    const result = new Map<number, number[]>()
    for (const item of listening) {
      const ports = result.get(item.pid)
      if (ports === undefined) {
        result.set(item.pid, [item.port])
      } else {
        ports.push(item.port)
      }
    }
    return result
  })

/** 采样一次全量进程；接前端时数值语义与 `ps` 一致。 */
export const collectProcesses = (): Promise<ProcessEntry[]> =>
  cached("processes", PROCESS_TTL, async () => {
    const startedAt = Math.floor(Date.now() / 1000)
    const [psOutput, commOutput, threads, ports] = await Promise.all([
      runCommand("/bin/ps", [
        "-axo",
        "pid=,ppid=,user=,pcpu=,rss=,stat=,etime=,args=",
      ]),
      runCommand("/bin/ps", ["-axo", "pid=,comm="]),
      collectThreadCounts(),
      collectPortsByPid(),
    ])

    const executables = new Map<number, string>()
    for (const line of commOutput.split("\n")) {
      const match = COMM_LINE.exec(line)
      if (match === null) continue
      executables.set(Number(match[1]), match[2].trim())
    }

    const entries: ProcessEntry[] = []
    for (const line of psOutput.split("\n")) {
      const match = PS_LINE.exec(line)
      if (match === null) continue
      const user = match[3]
      const state = match[6]
      const elapsed = match[7]
      if (user === undefined || state === undefined || elapsed === undefined) {
        continue
      }
      const pid = Number(match[1])
      const ppid = Number(match[2])
      const command = match[8]?.trim() ?? ""
      const executable = executables.get(pid) ?? command.split(/\s+/)[0] ?? ""
      const name = path.basename(executable) || executable || command
      const listeningPorts = ports.get(pid)
      entries.push({
        pid,
        ppid,
        name,
        command: command === "" ? executable : command,
        path: executable,
        user,
        state: stateOf(state),
        kind: kindOf(executable, name, ppid),
        cpu: Number(match[4]),
        memoryBytes: Number(match[5]) * 1024,
        threads: threads.get(pid) ?? null,
        ports:
          listeningPorts === undefined
            ? []
            : [...listeningPorts].sort((a, b) => a - b),
        startedAt: startedAt - parseElapsed(elapsed),
      })
    }

    return entries.sort((left, right) => right.cpu - left.cpu)
  })
