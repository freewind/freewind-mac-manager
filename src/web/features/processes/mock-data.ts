/**
 * 进程管理页面使用的采样数据。
 *
 * 字段与 `ps -axo pid,ppid,user,%cpu,%mem,rss,etime,comm` 加上 `lsof -nP -i`
 * 的输出一一对应；CPU、内存与速率会随 tick 抖动，让页面像持续采样。
 */

/** 进程状态，对应 ps 的 STAT 字段。 */
export type ProcessState = "running" | "sleeping" | "idle" | "stopped" | "zombie"

/** 进程归属，用于图标与文案。 */
export type ProcessKind = "kernel" | "daemon" | "app" | "helper" | "service"

export type ProcessInfo = {
  pid: number
  ppid: number
  name: string
  /** 完整命令行。 */
  command: string
  /** 可执行文件路径。 */
  path: string
  bundleId: string | null
  user: string
  state: ProcessState
  kind: ProcessKind
  /** 占单个核心的百分比，多线程进程可超过 100。 */
  cpu: number
  memoryBytes: number
  threads: number
  /** 正在监听的端口。 */
  ports: number[]
  /** 启动时刻（epoch 秒）。 */
  startedAt: number
  /** 能量影响，0-100。 */
  energyImpact: number
  diskReadBytesPerSec: number
  diskWriteBytesPerSec: number
  networkInBytesPerSec: number
  networkOutBytesPerSec: number
  openFiles: number
}

export type MemoryPressure = "normal" | "warning" | "critical"

export type MachineInfo = {
  /** 当前登录用户，用于「我的进程」筛选。 */
  user: string
  name: string
  model: string
  chip: string
  cores: number
  memoryTotalBytes: number
  osVersion: string
  diskName: string
  networkInterface: string
  /** 开机时刻（epoch 秒）。 */
  bootAt: number
}

export type SystemOverview = {
  /** 整机 CPU 占用百分比。 */
  cpuTotal: number
  cpuUser: number
  cpuSystem: number
  cpuIdle: number
  cores: number
  memoryUsedBytes: number
  memoryTotalBytes: number
  memoryCachedBytes: number
  swapUsedBytes: number
  memoryPressure: MemoryPressure
  diskReadBytesPerSec: number
  diskWriteBytesPerSec: number
  networkInBytesPerSec: number
  networkOutBytesPerSec: number
  loadAverage: [number, number, number]
  threadCount: number
}

/** 采样间隔（秒），刷新节奏由它决定。 */
export const REFRESH_INTERVAL_SECONDS = 2

/** 页面打开的时刻，进程启动时间与开机时间都以它为基准，运行时长会随会话增长。 */
const SESSION_START = Math.floor(Date.now() / 1000)

export const MACHINE: MachineInfo = {
  user: "peng.li",
  name: "peng.li 的 MacBook Pro",
  model: "MacBook Pro（14 英寸，M4 Pro，2024 年）",
  chip: "Apple M4 Pro",
  cores: 12,
  memoryTotalBytes: 36 * 1024 ** 3,
  osVersion: "macOS 15.3.1（24D70）",
  diskName: "Macintosh HD",
  networkInterface: "Wi-Fi（en0）",
  bootAt: SESSION_START - Math.round(6.4 * 86400),
}

type ProcessSeed = {
  pid: number
  ppid: number
  name: string
  user: string
  kind: ProcessKind
  /** 基准 CPU（占单核百分比）。 */
  cpu: number
  memoryMb: number
  threads: number
  /** 已经运行了多久（小时）。 */
  ageHours: number
  command: string
  state?: ProcessState
  ports?: number[]
  openFiles?: number
  bundleId?: string | null
  /** 每秒磁盘读/写字节数。 */
  disk?: [number, number]
  /** 每秒网络收/发字节数。 */
  net?: [number, number]
  /** 内存缓慢增长的速率（MB/分钟），用于表现疑似泄漏的进程。 */
  growthMbPerMinute?: number
}

const HOME = "/Users/peng.li"

const PROCESSES: ProcessSeed[] = [
  {
    pid: 0,
    ppid: 0,
    name: "kernel_task",
    user: "root",
    kind: "kernel",
    cpu: 11.2,
    memoryMb: 1420,
    threads: 96,
    ageHours: 153.6,
    command: "/System/Library/Kernels/kernel",
    state: "running",
    openFiles: 0,
  },
  {
    pid: 1,
    ppid: 0,
    name: "launchd",
    user: "root",
    kind: "daemon",
    cpu: 0.1,
    memoryMb: 12,
    threads: 4,
    ageHours: 153.6,
    command: "/sbin/launchd",
    openFiles: 36,
  },
  {
    pid: 268,
    ppid: 1,
    name: "WindowServer",
    user: "_windowserver",
    kind: "daemon",
    cpu: 6.8,
    memoryMb: 782,
    threads: 42,
    ageHours: 153.6,
    command:
      "/System/Library/PrivateFrameworks/SkyLight.framework/Versions/A/Resources/WindowServer -daemon",
    state: "running",
    openFiles: 512,
    disk: [128000, 42000],
  },
  {
    pid: 318,
    ppid: 1,
    name: "mds",
    user: "root",
    kind: "daemon",
    cpu: 2.1,
    memoryMb: 64,
    threads: 12,
    ageHours: 153.6,
    command: "/System/Library/Frameworks/CoreServices.framework/Frameworks/Metadata.framework/Support/mds",
    openFiles: 88,
    disk: [8400000, 3200000],
  },
  {
    pid: 322,
    ppid: 1,
    name: "mds_stores",
    user: "root",
    kind: "daemon",
    cpu: 18.4,
    memoryMb: 268,
    threads: 68,
    ageHours: 1.4,
    command:
      "/System/Library/Frameworks/CoreServices.framework/Frameworks/Metadata.framework/Versions/A/Support/mds_stores",
    state: "running",
    openFiles: 214,
    disk: [24800000, 9600000],
  },
  {
    pid: 187,
    ppid: 1,
    name: "configd",
    user: "root",
    kind: "daemon",
    cpu: 0.2,
    memoryMb: 8,
    threads: 5,
    ageHours: 153.6,
    command: "/usr/libexec/configd",
    openFiles: 42,
  },
  {
    pid: 189,
    ppid: 1,
    name: "powerd",
    user: "root",
    kind: "daemon",
    cpu: 0.3,
    memoryMb: 6,
    threads: 4,
    ageHours: 153.6,
    command: "/usr/libexec/powerd",
    state: "idle",
    openFiles: 28,
  },
  {
    pid: 351,
    ppid: 1,
    name: "coreaudiod",
    user: "_coreaudiod",
    kind: "daemon",
    cpu: 0.6,
    memoryMb: 24,
    threads: 12,
    ageHours: 153.6,
    command: "/usr/sbin/coreaudiod",
    openFiles: 74,
  },
  {
    pid: 284,
    ppid: 1,
    name: "mDNSResponder",
    user: "_mdnsresponder",
    kind: "daemon",
    cpu: 0.4,
    memoryMb: 14,
    threads: 9,
    ageHours: 153.6,
    command: "/usr/sbin/mDNSResponder",
    ports: [5353],
    openFiles: 88,
    net: [18400, 9200],
  },
  {
    pid: 267,
    ppid: 1,
    name: "securityd",
    user: "root",
    kind: "daemon",
    cpu: 0.2,
    memoryMb: 18,
    threads: 6,
    ageHours: 153.6,
    command: "/usr/sbin/securityd -i",
    openFiles: 64,
  },
  {
    pid: 641,
    ppid: 1,
    name: "backupd",
    user: "root",
    kind: "daemon",
    cpu: 3.4,
    memoryMb: 96,
    threads: 14,
    ageHours: 0.6,
    command: "/System/Library/CoreServices/backupd.bundle/Contents/Resources/backupd",
    state: "running",
    openFiles: 128,
    disk: [6200000, 18400000],
  },
  {
    pid: 301,
    ppid: 1,
    name: "distnoted",
    user: "peng.li",
    kind: "daemon",
    cpu: 0.1,
    memoryMb: 16,
    threads: 5,
    ageHours: 153.6,
    command: "/usr/sbin/distnoted agent",
    openFiles: 32,
  },
  {
    pid: 240,
    ppid: 1,
    name: "bluetoothd",
    user: "root",
    kind: "daemon",
    cpu: 0.1,
    memoryMb: 18,
    threads: 9,
    ageHours: 153.6,
    command: "/usr/sbin/bluetoothd",
    state: "idle",
    openFiles: 42,
  },
  {
    pid: 133,
    ppid: 1,
    name: "opendirectoryd",
    user: "root",
    kind: "daemon",
    cpu: 0.1,
    memoryMb: 26,
    threads: 7,
    ageHours: 153.6,
    command: "/usr/libexec/opendirectoryd",
    openFiles: 51,
  },
  {
    pid: 312,
    ppid: 1,
    name: "dasd",
    user: "root",
    kind: "daemon",
    cpu: 0.2,
    memoryMb: 22,
    threads: 8,
    ageHours: 153.6,
    command: "/usr/libexec/dasd",
    openFiles: 38,
  },
  {
    pid: 246,
    ppid: 1,
    name: "corebrightnessd",
    user: "root",
    kind: "daemon",
    cpu: 0.2,
    memoryMb: 9,
    threads: 4,
    ageHours: 153.6,
    command: "/usr/libexec/corebrightnessd",
    state: "idle",
    openFiles: 24,
  },
  {
    pid: 601,
    ppid: 1,
    name: "sharingd",
    user: "peng.li",
    kind: "daemon",
    cpu: 0.2,
    memoryMb: 22,
    threads: 7,
    ageHours: 153.6,
    command: "/System/Library/PrivateFrameworks/Sharing.framework/Versions/A/XPCServices/sharingd.xpc/Contents/MacOS/sharingd",
    ports: [58875],
    openFiles: 46,
  },
  {
    pid: 623,
    ppid: 1,
    name: "cloudd",
    user: "peng.li",
    kind: "daemon",
    cpu: 0.9,
    memoryMb: 58,
    threads: 16,
    ageHours: 153.6,
    command: "/System/Library/PrivateFrameworks/CloudKitDaemon.framework/Support/cloudd",
    openFiles: 112,
    net: [42000, 8600],
  },
  {
    pid: 676,
    ppid: 1,
    name: "routined",
    user: "peng.li",
    kind: "daemon",
    cpu: 0.3,
    memoryMb: 34,
    threads: 11,
    ageHours: 153.6,
    command: "/usr/libexec/routined LAUNCHED_BY_LAUNCHD",
    openFiles: 58,
  },
  {
    pid: 210,
    ppid: 1,
    name: "loginwindow",
    user: "peng.li",
    kind: "daemon",
    cpu: 0.4,
    memoryMb: 42,
    threads: 8,
    ageHours: 153.6,
    command: "/System/Library/CoreServices/loginwindow.app/Contents/MacOS/loginwindow console",
    openFiles: 96,
  },
  {
    pid: 508,
    ppid: 210,
    name: "Dock",
    user: "peng.li",
    kind: "app",
    cpu: 0.9,
    memoryMb: 168,
    threads: 18,
    ageHours: 153.6,
    command: "/System/Library/CoreServices/Dock.app/Contents/MacOS/Dock",
    bundleId: "com.apple.dock",
    openFiles: 148,
  },
  {
    pid: 512,
    ppid: 210,
    name: "Finder",
    user: "peng.li",
    kind: "app",
    cpu: 1.4,
    memoryMb: 328,
    threads: 26,
    ageHours: 153.6,
    command: "/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder",
    bundleId: "com.apple.finder",
    openFiles: 384,
    disk: [64000, 128000],
  },
  {
    pid: 515,
    ppid: 210,
    name: "SystemUIServer",
    user: "peng.li",
    kind: "app",
    cpu: 0.3,
    memoryMb: 96,
    threads: 12,
    ageHours: 153.6,
    command: "/System/Library/CoreServices/SystemUIServer.app/Contents/MacOS/SystemUIServer",
    bundleId: "com.apple.systemuiserver",
    openFiles: 118,
  },
  {
    pid: 517,
    ppid: 210,
    name: "ControlCenter",
    user: "peng.li",
    kind: "app",
    cpu: 0.5,
    memoryMb: 88,
    threads: 14,
    ageHours: 153.6,
    command: "/System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter",
    bundleId: "com.apple.controlcenter",
    openFiles: 102,
  },
  {
    pid: 519,
    ppid: 210,
    name: "NotificationCenter",
    user: "peng.li",
    kind: "app",
    cpu: 0.2,
    memoryMb: 112,
    threads: 15,
    ageHours: 153.6,
    command: "/System/Library/CoreServices/NotificationCenter.app/Contents/MacOS/NotificationCenter",
    bundleId: "com.apple.notificationcenterui",
    openFiles: 96,
  },
  {
    pid: 1042,
    ppid: 210,
    name: "Google Chrome",
    user: "peng.li",
    kind: "app",
    cpu: 4.2,
    memoryMb: 1180,
    threads: 58,
    ageHours: 42.2,
    command:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --flag-switches-begin --flag-switches-end",
    bundleId: "com.google.Chrome",
    openFiles: 1240,
    disk: [420000, 680000],
    net: [486000, 92000],
  },
  {
    pid: 1045,
    ppid: 1042,
    name: "Google Chrome Helper",
    user: "peng.li",
    kind: "helper",
    cpu: 0.4,
    memoryMb: 96,
    threads: 10,
    ageHours: 42.2,
    command: "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/133.0.6943.142/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper",
    bundleId: "com.google.Chrome.helper",
    openFiles: 186,
  },
  {
    pid: 1046,
    ppid: 1042,
    name: "Google Chrome Helper (GPU)",
    user: "peng.li",
    kind: "helper",
    cpu: 6.1,
    memoryMb: 288,
    threads: 24,
    ageHours: 42.2,
    command: "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/133.0.6943.142/Helpers/Google Chrome Helper (GPU).app/Contents/MacOS/Google Chrome Helper (GPU)",
    bundleId: "com.google.Chrome.helper.gpu",
    openFiles: 224,
  },
  {
    pid: 1058,
    ppid: 1042,
    name: "Google Chrome Helper (Renderer)",
    user: "peng.li",
    kind: "helper",
    cpu: 16.8,
    memoryMb: 862,
    threads: 44,
    ageHours: 3.6,
    command: "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/133.0.6943.142/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer) --type=renderer --extension-process",
    bundleId: "com.google.Chrome.helper.renderer",
    state: "running",
    openFiles: 412,
  },
  {
    pid: 1063,
    ppid: 1042,
    name: "Google Chrome Helper (Renderer)",
    user: "peng.li",
    kind: "helper",
    cpu: 2.4,
    memoryMb: 512,
    threads: 32,
    ageHours: 42.2,
    command: "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/133.0.6943.142/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer) --type=renderer",
    bundleId: "com.google.Chrome.helper.renderer",
    openFiles: 268,
  },
  {
    pid: 2870,
    ppid: 210,
    name: "Slack",
    user: "peng.li",
    kind: "app",
    cpu: 2.8,
    memoryMb: 892,
    threads: 46,
    ageHours: 38.4,
    command: "/Applications/Slack.app/Contents/MacOS/Slack",
    bundleId: "com.tinyspeck.slackmacgap",
    openFiles: 620,
    net: [68000, 22000],
  },
  {
    pid: 3021,
    ppid: 210,
    name: "微信",
    user: "peng.li",
    kind: "app",
    cpu: 1.2,
    memoryMb: 646,
    threads: 38,
    ageHours: 60.2,
    command: "/Applications/WeChat.app/Contents/MacOS/WeChat",
    bundleId: "com.tencent.xinWeChat",
    openFiles: 486,
    net: [24000, 12000],
  },
  {
    pid: 3410,
    ppid: 210,
    name: "Music",
    user: "peng.li",
    kind: "app",
    cpu: 0.7,
    memoryMb: 240,
    threads: 22,
    ageHours: 12.8,
    command: "/System/Applications/Music.app/Contents/MacOS/Music",
    bundleId: "com.apple.Music",
    openFiles: 176,
  },
  {
    pid: 2201,
    ppid: 210,
    name: "Cursor",
    user: "peng.li",
    kind: "app",
    cpu: 22.6,
    memoryMb: 2210,
    threads: 74,
    ageHours: 26.5,
    command: "/Applications/Cursor.app/Contents/MacOS/Cursor",
    bundleId: "com.todesktop.230313mzl4w4u92",
    state: "running",
    openFiles: 1840,
    disk: [1860000, 1240000],
    net: [32000, 18000],
  },
  {
    pid: 2216,
    ppid: 2201,
    name: "Cursor Helper (GPU)",
    user: "peng.li",
    kind: "helper",
    cpu: 3.2,
    memoryMb: 402,
    threads: 26,
    ageHours: 26.5,
    command: "/Applications/Cursor.app/Contents/Frameworks/Cursor Helper (GPU).app/Contents/MacOS/Cursor Helper (GPU) --type=gpu-process",
    openFiles: 268,
  },
  {
    pid: 2240,
    ppid: 2201,
    name: "Cursor Helper (Renderer)",
    user: "peng.li",
    kind: "helper",
    cpu: 9.4,
    memoryMb: 1440,
    threads: 51,
    ageHours: 26.5,
    command: "/Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Renderer).app/Contents/MacOS/Cursor Helper (Renderer) --type=renderer",
    state: "running",
    openFiles: 742,
    growthMbPerMinute: 1.6,
  },
  {
    pid: 2262,
    ppid: 2201,
    name: "Cursor Helper (Plugin)",
    user: "peng.li",
    kind: "helper",
    cpu: 1.1,
    memoryMb: 318,
    threads: 22,
    ageHours: 26.5,
    command: "/Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Plugin).app/Contents/MacOS/Cursor Helper (Plugin) --type=utility --utility-sub-type=node.mojom.NodeService",
    openFiles: 384,
  },
  {
    pid: 3310,
    ppid: 210,
    name: "Terminal",
    user: "peng.li",
    kind: "app",
    cpu: 0.6,
    memoryMb: 86,
    threads: 12,
    ageHours: 5.4,
    command: "/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal",
    bundleId: "com.apple.Terminal",
    openFiles: 128,
  },
  {
    pid: 4790,
    ppid: 3310,
    name: "pnpm",
    user: "peng.li",
    kind: "service",
    cpu: 0.3,
    memoryMb: 96,
    threads: 9,
    ageHours: 3.2,
    command: "node /Users/peng.li/.local/share/pnpm/pnpm dev",
    openFiles: 142,
  },
  {
    pid: 4810,
    ppid: 4790,
    name: "node",
    user: "peng.li",
    kind: "service",
    cpu: 7.6,
    memoryMb: 468,
    threads: 22,
    ageHours: 3.2,
    command: `node ${HOME}/workspace/freewind-mac-manager/node_modules/.bin/vite --host`,
    state: "running",
    ports: [7409],
    openFiles: 512,
    disk: [84000, 220000],
    net: [4200, 9800],
  },
  {
    pid: 4815,
    ppid: 4810,
    name: "esbuild",
    user: "peng.li",
    kind: "service",
    cpu: 0.9,
    memoryMb: 84,
    threads: 8,
    ageHours: 3.2,
    command: `${HOME}/workspace/freewind-mac-manager/node_modules/@esbuild/darwin-arm64/bin/esbuild --service=0.25.1 --ping`,
    state: "zombie",
    openFiles: 64,
  },
  {
    pid: 4832,
    ppid: 4790,
    name: "node",
    user: "peng.li",
    kind: "service",
    cpu: 1.8,
    memoryMb: 212,
    threads: 14,
    ageHours: 3.2,
    command: `node ${HOME}/workspace/paseo/packages/server/dist/bin.js`,
    ports: [5173],
    openFiles: 286,
    net: [18000, 6400],
  },
  {
    pid: 481,
    ppid: 1,
    name: "paseo",
    user: "peng.li",
    kind: "service",
    cpu: 2.4,
    memoryMb: 386,
    threads: 28,
    ageHours: 52.6,
    command: "/usr/local/bin/paseo daemon --host 127.0.0.1",
    ports: [18789],
    openFiles: 428,
    net: [12400, 8600],
  },
  {
    pid: 4402,
    ppid: 1,
    name: "postgres",
    user: "peng.li",
    kind: "service",
    cpu: 1.2,
    memoryMb: 512,
    threads: 18,
    ageHours: 96.4,
    command: "/opt/homebrew/opt/postgresql@17/bin/postgres -D /opt/homebrew/var/postgresql@17",
    ports: [5432],
    openFiles: 386,
    disk: [124000, 268000],
  },
  {
    pid: 4510,
    ppid: 1,
    name: "redis-server",
    user: "peng.li",
    kind: "service",
    cpu: 0.5,
    memoryMb: 42,
    threads: 6,
    ageHours: 96.4,
    command: "/opt/homebrew/opt/redis/bin/redis-server 127.0.0.1:6379",
    ports: [6379],
    openFiles: 96,
  },
  {
    pid: 4620,
    ppid: 1,
    name: "ollama",
    user: "peng.li",
    kind: "service",
    cpu: 0.8,
    memoryMb: 128,
    threads: 12,
    ageHours: 18.9,
    command: "/usr/local/bin/ollama serve",
    ports: [11434],
    openFiles: 118,
    state: "idle",
  },
  {
    pid: 4705,
    ppid: 1,
    name: "python3",
    user: "peng.li",
    kind: "service",
    cpu: 3.6,
    memoryMb: 724,
    threads: 24,
    ageHours: 9.2,
    command: "/opt/homebrew/opt/python@3.13/bin/python3.13 -m jupyterlab --no-browser",
    ports: [8888],
    openFiles: 342,
    disk: [68000, 128000],
  },
  {
    pid: 4010,
    ppid: 1,
    name: "com.docker.backend",
    user: "peng.li",
    kind: "service",
    cpu: 5.4,
    memoryMb: 1620,
    threads: 88,
    ageHours: 120.6,
    command: "/Applications/Docker.app/Contents/MacOS/com.docker.backend",
    bundleId: "com.docker.docker",
    ports: [2375],
    openFiles: 1264,
    disk: [420000, 986000],
    net: [86000, 42000],
  },
]

/** 用一个固定相位、随 tick 演进的波形制造稳定的抖动，避免每帧乱跳。 */
const wave = (seed: number, tick: number, period: number, offset: number): number =>
  Math.sin(tick / period + seed * 0.37 + offset)

const STATE_BY_DEFAULT = (seed: ProcessSeed): ProcessState =>
  seed.state ?? (seed.cpu >= 1 ? "running" : "sleeping")

const round1 = (value: number): number => Math.round(value * 10) / 10

const cpuValue = (seed: ProcessSeed, tick: number): number => {
  if (seed.cpu === 0) return 0
  const factor =
    1 +
    0.4 * wave(seed.pid, tick, 6.2, 0) +
    0.22 * wave(seed.pid, tick, 2.4, 1.1)
  return Math.max(0, round1(seed.cpu * factor))
}

const memoryValue = (seed: ProcessSeed, tick: number): number => {
  const base = seed.memoryMb * 1024 ** 2
  const drift = 1 + 0.012 * wave(seed.pid, tick, 11, 0.6)
  const growth =
    (seed.growthMbPerMinute ?? 0) *
    1024 ** 2 *
    ((tick * REFRESH_INTERVAL_SECONDS) / 60)
  return Math.round(base * drift + growth)
}

const rateValue = (
  pair: [number, number] | undefined,
  index: 0 | 1,
  pid: number,
  tick: number,
  period: number
): number => {
  const base = pair?.[index] ?? 0
  if (base === 0) return 0
  return Math.max(0, Math.round(base * (1 + 0.55 * wave(pid + index, tick, period, 0.3))))
}

export type ProcessSample = {
  processes: ProcessInfo[]
  overview: SystemOverview
}

/** 本次会话已经结束的进程，后续采样不再返回它们。 */
const terminatedPids = new Set<number>()

/** 采样计数，每次拉取推进一格，让 CPU、内存与速率持续抖动。 */
let sampleTick = 0

/** 采样一次进程列表；tick 递增时数值会随之变化。 */
const sampleProcesses = (tick: number): ProcessInfo[] =>
  PROCESSES.filter((seed) => !terminatedPids.has(seed.pid)).map((seed) => {
    const cpu = cpuValue(seed, tick)
    const memoryBytes = memoryValue(seed, tick)
    const threads = Math.max(
      1,
      seed.threads + (wave(seed.pid, tick, 17, 0.2) > 0.8 ? 1 : 0)
    )
    return {
      pid: seed.pid,
      ppid: seed.ppid,
      name: seed.name,
      command: seed.command,
      path: seed.command.split(" ")[0],
      bundleId: seed.bundleId ?? null,
      user: seed.user,
      state: STATE_BY_DEFAULT(seed),
      kind: seed.kind,
      cpu,
      memoryBytes,
      threads,
      ports: seed.ports ?? [],
      startedAt: SESSION_START - Math.round(seed.ageHours * 3600),
      energyImpact: Math.min(
        100,
        Math.round(cpu * 3 + (seed.kind === "kernel" ? 4 : 1.2))
      ),
      diskReadBytesPerSec: rateValue(seed.disk, 0, seed.pid, tick, 7.5),
      diskWriteBytesPerSec: rateValue(seed.disk, 1, seed.pid, tick, 5.1),
      networkInBytesPerSec: rateValue(seed.net, 0, seed.pid, tick, 4.3),
      networkOutBytesPerSec: rateValue(seed.net, 1, seed.pid, tick, 3.7),
      openFiles: seed.openFiles ?? 48,
    }
  })

/** 整机概览由进程列表汇总而来，保证卡片与表格数据自洽。 */
const buildOverview = (
  processes: ProcessInfo[],
  tick: number
): SystemOverview => {
  const { cores, memoryTotalBytes } = MACHINE
  const busy = processes.reduce((sum, item) => sum + item.cpu, 0) / cores
  const cpuTotal = Math.min(100, round1(busy + 2.6 + 0.9 * wave(7, tick, 9, 0)))
  const cpuUser = round1(cpuTotal * (0.58 + 0.05 * wave(3, tick, 13, 0.4)))
  const cpuSystem = round1(cpuTotal - cpuUser)
  const memoryUsedBytes = Math.min(
    memoryTotalBytes,
    processes.reduce((sum, item) => sum + item.memoryBytes, 0) +
      1.2 * 1024 ** 3
  )
  const memoryCachedBytes = Math.round(
    3.1 * 1024 ** 3 * (1 + 0.06 * wave(11, tick, 21, 0))
  )
  const ratio = memoryUsedBytes / memoryTotalBytes
  const memoryPressure =
    ratio >= 0.75 ? "critical" : ratio >= 0.55 ? "warning" : "normal"
  const backgroundRead = 4.6 * 1024 ** 2
  const backgroundWrite = 1.8 * 1024 ** 2
  const backgroundIn = 216 * 1024
  const backgroundOut = 48 * 1024
  return {
    cpuTotal,
    cpuUser,
    cpuSystem,
    cpuIdle: round1(Math.max(0, 100 - cpuTotal)),
    cores,
    memoryUsedBytes,
    memoryTotalBytes,
    memoryCachedBytes,
    swapUsedBytes: Math.round(
      (memoryPressure === "normal" ? 0.4 : 1.8) *
        1024 ** 3 *
        (1 + 0.05 * wave(5, tick, 19, 0))
    ),
    memoryPressure,
    diskReadBytesPerSec: Math.round(
      backgroundRead + processes.reduce((sum, item) => sum + item.diskReadBytesPerSec, 0)
    ),
    diskWriteBytesPerSec: Math.round(
      backgroundWrite + processes.reduce((sum, item) => sum + item.diskWriteBytesPerSec, 0)
    ),
    networkInBytesPerSec: Math.round(
      backgroundIn + processes.reduce((sum, item) => sum + item.networkInBytesPerSec, 0)
    ),
    networkOutBytesPerSec: Math.round(
      backgroundOut +
        processes.reduce((sum, item) => sum + item.networkOutBytesPerSec, 0)
    ),
    loadAverage: [
      round1((cpuTotal / 100) * cores * 1.18),
      round1((cpuTotal / 100) * cores * 0.94),
      round1((cpuTotal / 100) * cores * 0.86),
    ],
    threadCount: processes.reduce((sum, item) => sum + item.threads, 0),
  }
}

/** 拉取一次采样；接后端时换成 `@shared/client-api` 的调用。 */
export const fetchProcessSample = async (): Promise<ProcessSample> => {
  const tick = (sampleTick += 1)
  const processes = sampleProcesses(tick)
  return { processes, overview: buildOverview(processes, tick) }
}

export type TerminateOutcome = {
  succeeded: ProcessInfo[]
  denied: ProcessInfo[]
}

/**
 * 结束进程。
 *
 * 与真实系统一致：只能结束当前登录用户自己的进程，系统进程需要管理员权限，
 * 一律拒绝。成功结束的进程不会再出现在后续采样里。
 */
export const terminateProcesses = async (
  pids: number[]
): Promise<TerminateOutcome> => {
  const targets = sampleProcesses(sampleTick).filter((item) =>
    pids.includes(item.pid)
  )
  const succeeded = targets.filter((item) => item.user === MACHINE.user)
  const denied = targets.filter((item) => item.user !== MACHINE.user)
  for (const item of succeeded) terminatedPids.add(item.pid)
  return { succeeded, denied }
}
