import { spawn } from "node:child_process"
import { basename } from "node:path"
import type { PortBinding } from "@shared/api-contract"

type PortFamily = PortBinding["family"]
type PortState = PortBinding["state"]

/** 运行命令并取回 stdout；退出码 0 / 1 都算成功（1 表示没有匹配项）。 */
const run = (command: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
    const timer = setTimeout(() => child.kill("SIGTERM"), 10_000)
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code === 0 || code === 1) {
        resolve(stdout)
        return
      }
      reject(
        new Error(
          `${command} 退出码 ${code}${stderr.trim() ? `：${stderr.trim()}` : ""}`
        )
      )
    })
  })

type SocketRow = {
  pid: number
  processName: string
  user: string
  fd: string
  /** lsof 的 `t` 字段：IPv4 / IPv6。 */
  family: PortFamily | null
  protocol: "TCP" | "UDP"
  name: string
  state: string | null
}

/**
 * 解析 `lsof -FpcLnPT` 的字段流。
 *
 * 每个进程以 `p` 开头，每个文件描述符以 `f` 开头，其后的 `P`（协议）、
 * `n`（地址）、`T`（`ST=` 状态）都属于当前描述符。
 */
const parseLsof = (output: string): SocketRow[] => {
  const rows: SocketRow[] = []
  let process: { pid: number; name: string; user: string } | null = null
  let socket: {
    fd: string
    family: PortFamily | null
    protocol: "TCP" | "UDP"
    name: string
    state: string | null
  } | null = null

  const flush = (): void => {
    if (process && socket && socket.name) {
      rows.push({
        pid: process.pid,
        processName: process.name,
        user: process.user,
        fd: socket.fd,
        family: socket.family,
        protocol: socket.protocol,
        name: socket.name,
        state: socket.state,
      })
    }
    socket = null
  }

  for (const line of output.split("\n")) {
    if (line.length === 0) continue
    const tag = line[0]
    const value = line.slice(1)
    if (tag === "p") {
      flush()
      process = { pid: Number(value), name: "", user: "" }
      continue
    }
    if (tag === "c") {
      if (process) process.name = value
      continue
    }
    if (tag === "L") {
      if (process) process.user = value
      continue
    }
    if (tag === "f") {
      flush()
      socket = {
        fd: value,
        family: null,
        protocol: "TCP",
        name: "",
        state: null,
      }
      continue
    }
    if (!socket) continue
    if (tag === "P") {
      socket.protocol = value === "UDP" ? "UDP" : "TCP"
    } else if (tag === "t") {
      socket.family = value === "IPv6" ? "IPv6" : "IPv4"
    } else if (tag === "n") {
      socket.name = value
    } else if (tag === "T" && value.startsWith("ST=")) {
      socket.state = value.slice(3)
    }
  }
  flush()

  return rows.filter((row) => Number.isInteger(row.pid) && row.pid > 0)
}

type Endpoint = { address: string; port: number; family: PortFamily }

/** 解析 `127.0.0.1:8080`、`*:443`、`[::1]:8080`；端口不是数字（如 `*:*`）返回 null。 */
const parseEndpoint = (text: string): Endpoint | null => {
  const index = text.lastIndexOf(":")
  if (index <= 0) return null
  const portText = text.slice(index + 1)
  if (!/^\d+$/.test(portText)) return null
  const port = Number(portText)
  if (port <= 0) return null
  const address = text.slice(0, index)
  return { address, port, family: address.startsWith("[") ? "IPv6" : "IPv4" }
}

type ResolvedSocket = {
  port: number
  family: PortFamily
  address: string
  peer: string | null
  state: PortState
}

const resolveSocket = (row: SocketRow): ResolvedSocket | null => {
  if (row.protocol === "UDP") {
    const local = parseEndpoint(row.name)
    if (!local) return null
    return {
      port: local.port,
      family: row.family ?? local.family,
      address: local.address,
      peer: null,
      state: "UDP",
    }
  }

  const [localText = "", peerText] = row.name.split("->")
  if (peerText) {
    const peer = parseEndpoint(peerText)
    if (!peer) return null
    return {
      port: peer.port,
      family: row.family ?? peer.family,
      address: localText,
      peer: peerText,
      state: "ESTABLISHED",
    }
  }

  const local = parseEndpoint(localText)
  if (!local) return null
  return {
    port: local.port,
    family: row.family ?? local.family,
    address: local.address,
    peer: null,
    state: row.state === "LISTEN" ? "LISTEN" : "ESTABLISHED",
  }
}

type ProcessRow = {
  ppid: number
  command: string
  name: string
  startedAt: number
  cwd: string
}

const parsePairs = (
  output: string,
  handle: (pid: number, rest: string) => void
): void => {
  for (const line of output.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(.*)$/)
    if (!match) continue
    handle(Number(match[1]), match[2].trim())
  }
}

/** 取每个 PID 的父进程、完整命令、进程名与启动时间。 */
const loadProcessRows = async (
  pids: number[]
): Promise<Map<number, ProcessRow>> => {
  const rows = new Map<number, ProcessRow>()
  if (pids.length === 0) return rows
  const targets = pids.map(String)

  const [lstart, comm, command, cwd] = await Promise.all([
    run("/bin/ps", [
      "-ww",
      "-o",
      "pid=,ppid=,lstart=",
      "-p",
      targets.join(","),
    ]),
    run("/bin/ps", ["-ww", "-o", "pid=,comm=", "-p", targets.join(",")]),
    run("/bin/ps", ["-ww", "-o", "pid=,command=", "-p", targets.join(",")]),
    run("/usr/sbin/lsof", ["-a", "-p", targets.join(","), "-d", "cwd", "-Fpn"]),
  ])

  parsePairs(lstart, (pid, rest) => {
    const parsed = rest.match(/^(\d+)\s+(.+)$/)
    if (!parsed) return
    const time = Date.parse(parsed[2])
    rows.set(pid, {
      ppid: Number(parsed[1]),
      command: "",
      name: "",
      startedAt: Number.isNaN(time) ? 0 : Math.floor(time / 1000),
      cwd: "",
    })
  })
  parsePairs(comm, (pid, rest) => {
    const row = rows.get(pid)
    if (row) row.name = basename(rest)
  })
  parsePairs(command, (pid, rest) => {
    const row = rows.get(pid)
    if (row) row.command = rest
  })

  // cwd 用 `lsof -d cwd -Fpn`，每个进程恰好一条 n 记录。
  let currentPid = 0
  for (const line of cwd.split("\n")) {
    if (line.startsWith("p")) {
      currentPid = Number(line.slice(1))
      continue
    }
    if (line.startsWith("n") && currentPid > 0) {
      const row = rows.get(currentPid)
      if (row) row.cwd = line.slice(1)
    }
  }

  return rows
}

/** 父进程名：PID 1 记作 launchd，其余查 comm。 */
const loadParentNames = async (
  pids: number[]
): Promise<Map<number, string>> => {
  const names = new Map<number, string>()
  const targets = [...new Set(pids)].filter((pid) => pid > 0)
  if (targets.length === 0) return names
  const output = await run("/bin/ps", [
    "-ww",
    "-o",
    "pid=,comm=",
    "-p",
    targets.join(","),
  ])
  parsePairs(output, (pid, rest) => names.set(pid, basename(rest)))
  return names
}

/** 采集本机当前全部 TCP / UDP 套接字绑定。 */
export const collectPortBindings = async (): Promise<PortBinding[]> => {
  const output = await run("/usr/sbin/lsof", [
    "-nP",
    "-iTCP",
    "-iUDP",
    "-FpcLnPTt",
  ])
  const sockets = parseLsof(output)

  const pids = [...new Set(sockets.map((row) => row.pid))]
  const processes = await loadProcessRows(pids)
  const parentNames = await loadParentNames(
    [...processes.values()].map((row) => row.ppid)
  )

  const bindings: PortBinding[] = []
  for (const row of sockets) {
    const resolved = resolveSocket(row)
    if (!resolved) continue
    const process = processes.get(row.pid)
    const processName = process?.name || row.processName
    const startedBy =
      process === undefined
        ? "未知"
        : process.ppid === 1
          ? "launchd"
          : (parentNames.get(process.ppid) ?? `PID ${process.ppid}`)

    bindings.push({
      key: `${processName}#${row.pid}#${resolved.port}#${resolved.family}#${row.fd}`,
      port: resolved.port,
      protocol: row.protocol,
      family: resolved.family,
      address: resolved.address,
      peer: resolved.peer,
      state: resolved.state,
      pid: row.pid,
      processName,
      user: row.user,
      startedBy,
      command: process?.command ?? row.processName,
      cwd: process?.cwd ?? "",
      startedAt: process?.startedAt ?? 0,
    })
  }

  return bindings
}
