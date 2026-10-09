import { execFile } from "node:child_process"
import os from "node:os"
import path from "node:path"
import type {
  CpuInfo,
  DiskVolume,
  MachineOverview,
  MemoryInfo,
  NetworkInfo,
  PortInfo,
  ProcessInfo,
  SystemInfo,
} from "@shared/api-contract"

export const runCommand = (command: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(
          new Error(`${path.basename(command)} 执行失败：${error.message}`)
        )
        return
      }
      resolve(stdout)
    })
  })

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

const num = (text: string | undefined): number => {
  const value = Number(text)
  return Number.isFinite(value) ? value : 0
}

/**
 * 少量命令（df、lsof）单次要一两秒，加一层极短 TTL 缓存，
 * 免得页面每 3 秒刷新时把机器拖慢。
 */
const cache = new Map<string, { at: number; value: unknown }>()

export const cached = async <T>(
  key: string,
  ttl: number,
  load: () => Promise<T>
): Promise<T> => {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.value as T
  const value = await load()
  cache.set(key, { at: Date.now(), value })
  return value
}

const collectSystem = async (): Promise<SystemInfo> => {
  const [swVers, model, chip, who] = await Promise.all([
    runCommand("/usr/bin/sw_vers", []),
    runCommand("/usr/sbin/sysctl", ["-n", "hw.model"]).catch(() => ""),
    runCommand("/usr/sbin/sysctl", ["-n", "machdep.cpu.brand_string"]).catch(
      () => ""
    ),
    runCommand("/usr/bin/who", []).catch(() => ""),
  ])
  const version = /ProductVersion:\s*(\S+)/.exec(swVers)?.[1] ?? ""
  const build = /BuildVersion:\s*(\S+)/.exec(swVers)?.[1] ?? ""
  return {
    hostname: os.hostname(),
    model: model.trim() || "未知机型",
    chip: chip.trim() || os.cpus()[0]?.model.trim() || "未知芯片",
    osVersion: version
      ? `macOS ${version}${build ? `（${build}）` : ""}`
      : "macOS",
    uptimeSeconds: Math.round(os.uptime()),
    userCount: who.split("\n").filter((line) => line.trim().length > 0).length,
  }
}

type CpuTicks = { at: number; ticks: { busy: number; total: number }[] }

const readCpuTicks = (): CpuTicks["ticks"] =>
  os.cpus().map((cpu) => {
    const times = cpu.times
    const busy = times.user + times.nice + times.sys + times.irq
    return { busy, total: busy + times.idle }
  })

const usageBetween = (
  before: CpuTicks["ticks"],
  after: CpuTicks["ticks"]
): number[] =>
  after.map((item, index) => {
    const previous = before[index]
    if (!previous) return 0
    const total = item.total - previous.total
    if (total <= 0) return 0
    return Math.max(
      0,
      Math.min(100, ((item.busy - previous.busy) / total) * 100)
    )
  })

/** 每核占用率要靠两次采样求差，这里留着上一轮的采样点。 */
let lastCpu: CpuTicks | null = null
let lastCpuUsage: number[] = []

const collectCpu = async (): Promise<CpuInfo> => {
  const loadAverage = os.loadavg()
  const current: CpuTicks = { at: Date.now(), ticks: readCpuTicks() }
  if (!lastCpu) {
    await delay(200)
    const next: CpuTicks = { at: Date.now(), ticks: readCpuTicks() }
    lastCpuUsage = usageBetween(current.ticks, next.ticks)
    lastCpu = next
  } else if (current.at - lastCpu.at >= 800) {
    lastCpuUsage = usageBetween(lastCpu.ticks, current.ticks)
    lastCpu = current
  }
  return {
    loadAverage: [
      loadAverage[0] ?? 0,
      loadAverage[1] ?? 0,
      loadAverage[2] ?? 0,
    ],
    coreCount: current.ticks.length,
    coreUsage: lastCpuUsage.map((value) => Math.round(value * 10) / 10),
  }
}

const collectMemory = async (): Promise<MemoryInfo> => {
  const [memSize, vmStat, swap] = await Promise.all([
    runCommand("/usr/sbin/sysctl", ["-n", "hw.memsize"]),
    runCommand("/usr/bin/vm_stat", []),
    runCommand("/usr/sbin/sysctl", ["-n", "vm.swapusage"]),
  ])
  const pageSize = num(/page size of (\d+) bytes/.exec(vmStat)?.[1])
  const pages = (label: string): number =>
    num(new RegExp(`^${label}:\\s+(\\d+)\\.`, "m").exec(vmStat)?.[1]) * pageSize
  const active = pages("Pages active")
  const wired = pages("Pages wired down")
  const compressed = pages("Pages occupied by compressor")
  const free = pages("Pages free")
  const inactive = pages("Pages inactive")
  const speculative = pages("Pages speculative")
  return {
    total: num(memSize.trim()),
    used: active,
    wired,
    compressed,
    // 可用 = 完全空闲 + 不活跃 + 推测，macOS 会把不活跃页让给新进程
    free: free + inactive + speculative,
    swapTotal: num(/total = ([\d.]+)M/.exec(swap)?.[1]) * 1024 ** 2,
    swapUsed: num(/used = ([\d.]+)M/.exec(swap)?.[1]) * 1024 ** 2,
  }
}

/**
 * APFS 上 `/` 是只读系统快照，真正占地方的是同一容器的 Data 卷；
 * 外接只读卷（各类 dmg）只是挂载的安装镜像，不进仪表盘。
 */
const collectDisk = (): Promise<DiskVolume[]> =>
  cached("disk", 10_000, async () => {
    const [dfOutput, mountOutput] = await Promise.all([
      runCommand("/bin/df", ["-k"]),
      runCommand("/sbin/mount", []),
    ])
    const readOnly = new Set<string>()
    for (const line of mountOutput.split("\n")) {
      const match = /^(\S+) on (.+?) \(([^)]*)\)$/.exec(line)
      if (!match) continue
      if (match[3].split(", ").includes("read-only")) readOnly.add(match[1])
    }

    const others: DiskVolume[] = []
    let dataVolume: DiskVolume | null = null
    let rootVolume: DiskVolume | null = null
    for (const line of dfOutput.split("\n").slice(1)) {
      const match =
        /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/.exec(
          line.trim()
        )
      if (!match) continue
      const device = match[1]
      const mount = match[9].trim()
      const volume: DiskVolume = {
        name: mount === "/" ? "系统盘" : path.basename(mount),
        mount,
        total: num(match[2]) * 1024,
        used: num(match[3]) * 1024,
        free: num(match[4]) * 1024,
      }
      if (mount === "/System/Volumes/Data") {
        dataVolume = { ...volume, name: "系统盘", mount: "/" }
      } else if (mount === "/") {
        rootVolume = volume
      } else if (mount.startsWith("/Volumes/") && !readOnly.has(device)) {
        others.push(volume)
      }
    }
    // Data 卷存在时它就是系统盘，`/` 那份只读快照只是兜底
    const primary = dataVolume ?? rootVolume
    others.sort((left, right) => right.total - left.total)
    return primary ? [primary, ...others] : others
  })

/** 速率要靠两次采样求差，这里留着上一轮的累计字节。 */
let lastNetwork: { at: number; bytesIn: number; bytesOut: number } | null = null

const primaryAddress = (name: string): string => {
  const external = (os.networkInterfaces()[name] ?? []).filter(
    (item) => !item.internal
  )
  const ipv4 = external.find((item) => item.family === "IPv4")
  return (ipv4 ?? external[0])?.address ?? "—"
}

const collectNetwork = async (): Promise<NetworkInfo> => {
  const output = await runCommand("/usr/sbin/netstat", ["-ibn"])
  let bytesIn = 0
  let bytesOut = 0
  let busiest = { name: "", total: 0 }
  for (const line of output.split("\n")) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 10) continue
    const name = fields[0] ?? ""
    // 只有 <Link#N> 行带累计字节，其余行是同一接口的地址明细，重复计数
    if (!/^<Link#\d+>$/.test(fields[2] ?? "")) continue
    if (name === "lo0" || name.startsWith("gif") || name.startsWith("stf")) {
      continue
    }
    const currentIn = num(fields[fields.length - 5])
    const currentOut = num(fields[fields.length - 2])
    bytesIn += currentIn
    bytesOut += currentOut
    if (currentIn + currentOut > busiest.total) {
      busiest = { name, total: currentIn + currentOut }
    }
  }
  const at = Date.now()
  const previous = lastNetwork
  lastNetwork = { at, bytesIn, bytesOut }
  const seconds = previous ? Math.max(0.001, (at - previous.at) / 1000) : 0
  return {
    interfaceName: busiest.name || "—",
    address: busiest.name ? primaryAddress(busiest.name) : "—",
    downloadRate: previous
      ? Math.max(0, (bytesIn - previous.bytesIn) / seconds)
      : 0,
    uploadRate: previous
      ? Math.max(0, (bytesOut - previous.bytesOut) / seconds)
      : 0,
    totalDown: bytesIn,
    totalUp: bytesOut,
  }
}

export const collectTopProcesses = async (
  limit: number
): Promise<ProcessInfo[]> => {
  const output = await runCommand("/bin/ps", [
    "-axo",
    "pid=,pcpu=,pmem=,rss=,user=,args=",
    "-r",
  ])
  const processes: ProcessInfo[] = []
  for (const line of output.split("\n")) {
    const match =
      /^\s*(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line)
    if (!match) continue
    const command = match[6].trim()
    processes.push({
      pid: num(match[1]),
      name: path.basename(command.split(/\s+/)[0] ?? "") || command,
      user: match[5],
      cpu: num(match[2]),
      memory: num(match[4]) * 1024,
      command,
    })
    if (processes.length >= limit) break
  }
  return processes
}

const splitAddress = (name: string): { address: string; port: string } => {
  const text = name.replace(/\s*\(LISTEN\)\s*$/, "")
  const index = text.lastIndexOf(":")
  if (index < 0) return { address: text, port: "" }
  return {
    address: text.slice(0, index).replace(/^\[|\]$/g, ""),
    port: text.slice(index + 1),
  }
}

export const collectListeningPorts = (): Promise<PortInfo[]> =>
  cached("ports", 5_000, async () => {
    const output = await runCommand("/usr/sbin/lsof", [
      "-nP",
      "-iTCP",
      "-sTCP:LISTEN",
      "-Fpcn",
    ])
    const ports = new Map<string, PortInfo>()
    let pid = 0
    let process = ""
    for (const line of output.split("\n")) {
      const tag = line.slice(0, 1)
      const value = line.slice(1).trim()
      if (tag === "p") {
        pid = num(value)
      } else if (tag === "c") {
        process = value
      } else if (tag === "n") {
        const { address, port } = splitAddress(value)
        const portNumber = num(port)
        if (portNumber <= 0) continue
        // 同一进程可能同时监听 IPv4 与 IPv6，只留一条
        const key = `${portNumber}-${pid}`
        if (ports.has(key)) continue
        ports.set(key, {
          port: portNumber,
          process: process || "—",
          pid,
          address,
        })
      }
    }
    return [...ports.values()].sort((left, right) => left.port - right.port)
  })

export const collectMachineOverview = async (): Promise<MachineOverview> => {
  const [system, cpu, memory, disk, network] = await Promise.all([
    collectSystem(),
    collectCpu(),
    collectMemory(),
    collectDisk(),
    collectNetwork(),
  ])
  return { sampledAt: Date.now(), system, cpu, memory, disk, network }
}
