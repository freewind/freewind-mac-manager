/** 概览页的假数据。量级参照本机：64G 内存、swap 接近用满、系统盘约八成满。 */

export type SystemInfo = {
  hostname: string
  model: string
  chip: string
  osVersion: string
  uptimeSeconds: number
  userCount: number
}

export type CpuInfo = {
  loadAverage: number[]
  coreCount: number
  coreUsage: number[]
}

export type MemoryInfo = {
  total: number
  used: number
  wired: number
  compressed: number
  free: number
  swapTotal: number
  swapUsed: number
}

export type DiskVolume = {
  name: string
  mount: string
  total: number
  used: number
  free: number
}

export type DiskInfo = {
  volumes: DiskVolume[]
}

export type NetworkInfo = {
  interfaceName: string
  address: string
  downloadRate: number
  uploadRate: number
  totalDown: number
  totalUp: number
}

export type ProcessInfo = {
  pid: number
  name: string
  user: string
  cpu: number
  memory: number
  command: string
}

export type PortInfo = {
  port: number
  process: string
  pid: number
  address: string
}

export type Overview = {
  sampledAt: number
  system: SystemInfo
  cpu: CpuInfo
  memory: MemoryInfo
  disk: DiskInfo
  network: NetworkInfo
  processes: ProcessInfo[]
  ports: PortInfo[]
}

const GIB = 1024 ** 3
const MIB = 1024 ** 2

/** 围绕基准值做周期摆动，让每次刷新都有点变化但不离谱。 */
const wobble = (base: number, ratio: number, tick: number, phase = 0): number =>
  Math.max(0, base * (1 + ratio * Math.sin(tick / 2.2 + phase)))

const CORE_PHASES = [0.4, 1.1, 1.9, 2.6, 3.3, 4.1, 4.8, 5.5]

export const createMockOverview = (tick: number): Overview => {
  const totalMemory = 64 * GIB
  const wired = 9.2 * GIB
  const compressed = 6.4 * GIB
  const used = wobble(47.5 * GIB, 0.04, tick, 0.7)
  const free = totalMemory - used - wired - compressed

  const systemTotal = 1.82 * 1024 ** 4
  const systemUsed = 1.45 * 1024 ** 4

  return {
    sampledAt: Date.now(),
    system: {
      hostname: "freewind-mac",
      model: "Mac Pro (2019)",
      chip: "AMD Ryzen 7 9700X 8-Core",
      osVersion: "macOS 14.7.5 (23H527)",
      uptimeSeconds: 687600 + tick * 3,
      userCount: 2,
    },
    cpu: {
      loadAverage: [
        wobble(1.24, 0.35, tick),
        wobble(2.39, 0.25, tick, 1.2),
        wobble(2.84, 0.15, tick, 2.4),
      ],
      coreCount: CORE_PHASES.length,
      coreUsage: CORE_PHASES.map((phase, index) =>
        Math.min(99, wobble(26 + index * 3, 0.7, tick, phase))
      ),
    },
    memory: {
      total: totalMemory,
      used,
      wired,
      compressed,
      free,
      swapTotal: 72 * GIB,
      swapUsed: wobble(70.4 * GIB, 0.015, tick, 1.7),
    },
    disk: {
      volumes: [
        {
          name: "Macintosh HD",
          mount: "/",
          total: systemTotal,
          used: systemUsed,
          free: systemTotal - systemUsed,
        },
        {
          name: "Backup",
          mount: "/Volumes/Backup",
          total: 2 * 1024 ** 4,
          used: 1.12 * 1024 ** 4,
          free: 0.88 * 1024 ** 4,
        },
        {
          name: "Factory",
          mount: "/Volumes/Factory",
          total: 891 * MIB,
          used: 575 * MIB,
          free: 316 * MIB,
        },
      ],
    },
    network: {
      interfaceName: "en0",
      address: "192.168.1.23",
      downloadRate: wobble(4.2 * MIB, 0.8, tick, 0.3),
      uploadRate: wobble(0.86 * MIB, 0.9, tick, 2.1),
      totalDown: 38.6 * GIB,
      totalUp: 4.2 * GIB,
    },
    processes: [
      {
        pid: 47180,
        name: "node",
        user: "peng.li",
        cpu: wobble(19.5, 0.4, tick, 0.6),
        memory: 0.9 * GIB,
        command: "node dist-ssr/server/main.js",
      },
      {
        pid: 57135,
        name: "Paseo",
        user: "peng.li",
        cpu: wobble(15.1, 0.5, tick, 1.8),
        memory: 0.83 * GIB,
        command: "/Applications/Paseo.app/Contents/MacOS/Paseo",
      },
      {
        pid: 97,
        name: "WindowServer",
        user: "_windowserver",
        cpu: wobble(12.4, 0.3, tick, 2.9),
        memory: 0.19 * GIB,
        command: "/System/Library/Frameworks/.../WindowServer",
      },
      {
        pid: 27251,
        name: "Google Chrome",
        user: "peng.li",
        cpu: wobble(9.2, 0.6, tick, 3.7),
        memory: 0.64 * GIB,
        command: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      },
      {
        pid: 63042,
        name: "Cursor",
        user: "peng.li",
        cpu: wobble(7.3, 0.5, tick, 4.4),
        memory: 0.71 * GIB,
        command: "/Applications/Cursor.app/Contents/MacOS/Cursor",
      },
      {
        pid: 495,
        name: "caddy",
        user: "peng.li",
        cpu: wobble(2.1, 0.5, tick, 5.2),
        memory: 0.06 * GIB,
        command: "caddy run --config Caddyfile",
      },
    ],
    ports: [
      { port: 7409, process: "node", pid: 47180, address: "*" },
      { port: 18789, process: "node", pid: 481, address: "127.0.0.1" },
      { port: 8443, process: "caddy", pid: 495, address: "*" },
      { port: 8765, process: "FreewindServer", pid: 504, address: "*" },
      { port: 7880, process: "freewind_paseo", pid: 510, address: "*" },
      { port: 7265, process: "Raycast", pid: 522, address: "127.0.0.1" },
      {
        port: 59011,
        process: "sandbox-client",
        pid: 4428,
        address: "127.0.0.1",
      },
    ],
  }
}
