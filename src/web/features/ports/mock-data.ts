/**
 * 端口管理页面使用的采集数据。
 *
 * 字段与 `lsof -nP -i` 的输出一一对应：协议、地址、状态、PID、用户、命令等。
 * 每条记录代表一个套接字绑定（一个 FD），同一端口的多条记录会聚合成一个端口分组。
 */

export type PortProtocol = "TCP" | "UDP"

/** 套接字状态：LISTEN 监听中，ESTABLISHED 已建立连接，UDP 无连接。 */
export type PortState = "LISTEN" | "ESTABLISHED" | "UDP"

export type PortFamily = "IPv4" | "IPv6"

/** 端口归属分类，用于左侧快捷视图。 */
export type PortCategory = "dev" | "database" | "proxy" | "system" | "app"

export type PortBinding = {
  key: string
  /** 端口号：监听端口取本机端口，已建立连接取对端服务端口。 */
  port: number
  protocol: PortProtocol
  family: PortFamily
  /** 本机套接字地址，如 `127.0.0.1`、`*`、`[::1]`、`192.168.1.8:52344`。 */
  address: string
  /** 已建立连接的对端地址；监听套接字为 null。 */
  peer: string | null
  state: PortState
  pid: number
  processName: string
  user: string
  /** 启动者：launchd、zsh、npm、某个桌面应用等。 */
  startedBy: string
  command: string
  /** 进程工作目录，用于判断端口归属哪个项目。 */
  cwd: string
  /** 进程启动时间（秒）。 */
  startedAt: number
}

export type PortService = {
  label: string
  category: PortCategory
}

export type PortGroup = {
  port: number
  service: PortService
  category: PortCategory
  /** 是否监听在所有网卡（可能对外暴露）。 */
  exposed: boolean
  protocols: PortProtocol[]
  addresses: string[]
  processNames: string[]
  pids: number[]
  starters: string[]
  state: PortState
  bindings: PortBinding[]
}

/** 常见端口的服务识别表。 */
const KNOWN_SERVICES: Record<number, PortService> = {
  22: { label: "SSH 远程登录", category: "system" },
  443: { label: "HTTPS 出站连接", category: "system" },
  3000: { label: "Next.js 开发服务", category: "dev" },
  5173: { label: "Vite 开发服务", category: "dev" },
  5432: { label: "PostgreSQL", category: "database" },
  6006: { label: "Storybook", category: "dev" },
  6379: { label: "Redis", category: "database" },
  7265: { label: "Raycast 本地接口", category: "app" },
  7878: { label: "Freewind Remote Shell", category: "app" },
  7880: { label: "Freewind Lan Chat", category: "app" },
  7897: { label: "Clash Verge 混合代理", category: "proxy" },
  8443: { label: "Caddy HTTPS", category: "proxy" },
  8765: { label: "Freewind Server", category: "app" },
  9097: { label: "Clash Verge 控制接口", category: "proxy" },
  18789: { label: "Paseo Daemon", category: "app" },
  33333: { label: "Node 临时服务", category: "dev" },
  39393: { label: "Freewind Lan Chat 传输", category: "app" },
  5353: { label: "mDNSResponder 服务发现", category: "system" },
  56574: { label: "LANDrop 传输", category: "app" },
  63040: { label: "Clash 内核内部端口", category: "proxy" },
}

/** 未收录的端口按范围兜底：小于 1024 视为系统保留端口。 */
export const describePort = (port: number): PortService => {
  const known = KNOWN_SERVICES[port]
  if (known) return known
  if (port < 1024) return { label: "系统保留端口", category: "system" }
  return { label: "未识别服务", category: "app" }
}

/** 监听地址是通配符即为「对外暴露」，本机回环地址为「仅本机」。 */
export const isExposedAddress = (address: string): boolean =>
  address === "*" ||
  address.startsWith("0.0.0.0") ||
  address.startsWith("[::]") ||
  address.startsWith("::")

const START = Math.floor(Date.now() / 1000)

let seq = 0

type BindingInput = {
  port: number
  address: string
  pid: number
  processName: string
  startedBy: string
  command: string
  cwd: string
  protocol?: PortProtocol
  family?: PortFamily
  state?: PortState
  peer?: string
  user?: string
  startedSecondsAgo?: number
}

const binding = (input: BindingInput): PortBinding => {
  seq += 1
  const protocol = input.protocol ?? "TCP"
  const state =
    input.state ?? (protocol === "UDP" ? "UDP" : "LISTEN")
  const family = input.family ?? "IPv4"
  return {
    key: `${input.processName}#${input.pid}#${input.port}#${family}#${seq}`,
    port: input.port,
    protocol,
    family,
    address: input.address,
    peer: input.peer ?? null,
    state,
    pid: input.pid,
    processName: input.processName,
    user: input.user ?? "peng.li",
    startedBy: input.startedBy,
    command: input.command,
    cwd: input.cwd,
    startedAt: START - (input.startedSecondsAgo ?? 3600),
  }
}

export const mockPortBindings: PortBinding[] = [
  // 18789 — Paseo Daemon（本机回环，双栈）
  binding({
    port: 18789,
    family: "IPv4",
    address: "127.0.0.1",
    pid: 481,
    processName: "node",
    startedBy: "launchd",
    command:
      "node /Users/peng.li/workspace/freewind-paseo/dist/daemon.js --port 18789",
    cwd: "/Users/peng.li/workspace/freewind-paseo",
    startedSecondsAgo: 8421,
  }),
  binding({
    port: 18789,
    family: "IPv6",
    address: "[::1]",
    pid: 481,
    processName: "node",
    startedBy: "launchd",
    command:
      "node /Users/peng.li/workspace/freewind-paseo/dist/daemon.js --port 18789",
    cwd: "/Users/peng.li/workspace/freewind-paseo",
    startedSecondsAgo: 8421,
  }),

  // 8443 — Caddy 反向代理（对所有网卡开放）
  binding({
    port: 8443,
    family: "IPv6",
    address: "[::]",
    pid: 495,
    processName: "caddy",
    startedBy: "launchd",
    command: "/opt/homebrew/bin/caddy run --config /Users/peng.li/.config/frp/Caddyfile",
    cwd: "/Users/peng.li/.config/frp",
    startedSecondsAgo: 8300,
  }),

  // 8765 — Freewind Server
  binding({
    port: 8765,
    address: "*",
    pid: 504,
    processName: "FreewindServer",
    startedBy: "launchd",
    command: "/Users/peng.li/workspace/freewind-agent-hub/FreewindServer --port 8765",
    cwd: "/Users/peng.li/workspace/freewind-agent-hub",
    startedSecondsAgo: 8280,
  }),
  binding({
    port: 8765,
    address: "127.0.0.1:55120",
    state: "ESTABLISHED",
    peer: "127.0.0.1:8765",
    pid: 47120,
    processName: "curl",
    startedBy: "zsh",
    command: "curl -s http://127.0.0.1:8765/api/health",
    cwd: "/Users/peng.li",
    startedSecondsAgo: 240,
  }),

  // 7880 — Freewind Lan Chat
  binding({
    port: 7880,
    family: "IPv6",
    address: "[::]",
    pid: 510,
    processName: "freewind_lan_chat",
    startedBy: "zsh",
    command: "node dist/server.js --port 7880",
    cwd: "/Users/peng.li/workspace/freewind-lan-chat",
    startedSecondsAgo: 7200,
  }),

  // 7265 — Raycast 本地接口（仅本机）
  binding({
    port: 7265,
    address: "127.0.0.1",
    pid: 522,
    processName: "Raycast",
    startedBy: "launchd",
    command: "/Applications/Raycast.app/Contents/MacOS/Raycast",
    cwd: "/Applications/Raycast.app/Contents/MacOS",
    startedSecondsAgo: 8100,
  }),

  // 5173 — Vite 开发服务（对所有网卡开放）
  binding({
    port: 5173,
    address: "*",
    pid: 39021,
    processName: "node",
    startedBy: "npm",
    command:
      "node /Users/peng.li/workspace/freewind-mac-manager/node_modules/.bin/vite --host",
    cwd: "/Users/peng.li/workspace/freewind-mac-manager",
    startedSecondsAgo: 1860,
  }),
  binding({
    port: 443,
    address: "192.168.1.8:52344",
    state: "ESTABLISHED",
    peer: "104.16.0.35:443",
    pid: 39021,
    processName: "node",
    startedBy: "npm",
    command:
      "node /Users/peng.li/workspace/freewind-mac-manager/node_modules/.bin/vite --host",
    cwd: "/Users/peng.li/workspace/freewind-mac-manager",
    startedSecondsAgo: 1860,
  }),

  // 3000 — Next.js 开发服务
  binding({
    port: 3000,
    address: "127.0.0.1",
    pid: 41230,
    processName: "next-server",
    startedBy: "zsh",
    command:
      "node /Users/peng.li/workspace/shadcn-ui/node_modules/.bin/next dev --turbopack",
    cwd: "/Users/peng.li/workspace/shadcn-ui",
    startedSecondsAgo: 12600,
  }),
  binding({
    port: 5432,
    address: "127.0.0.1:56123",
    state: "ESTABLISHED",
    peer: "127.0.0.1:5432",
    pid: 41230,
    processName: "next-server",
    startedBy: "zsh",
    command:
      "node /Users/peng.li/workspace/shadcn-ui/node_modules/.bin/next dev --turbopack",
    cwd: "/Users/peng.li/workspace/shadcn-ui",
    startedSecondsAgo: 12600,
  }),

  // 6006 — Storybook
  binding({
    port: 6006,
    address: "127.0.0.1",
    pid: 28110,
    processName: "storybook",
    startedBy: "npm",
    command: "node /usr/local/bin/storybook dev -p 6006",
    cwd: "/Users/peng.li/workspace/feelime",
    startedSecondsAgo: 25200,
  }),

  // 33333 — Node 临时服务
  binding({
    port: 33333,
    family: "IPv6",
    address: "[::]",
    pid: 26008,
    processName: "node",
    startedBy: "zsh",
    command: "node server.js --port 33333",
    cwd: "/Users/peng.li/workspace/freewind-paste",
    startedSecondsAgo: 4300,
  }),

  // 5432 — PostgreSQL（本机回环，双栈）
  binding({
    port: 5432,
    address: "127.0.0.1",
    pid: 51234,
    processName: "postgres",
    startedBy: "launchd",
    command:
      "/opt/homebrew/opt/postgresql@17/bin/postgres -D /opt/homebrew/var/postgresql@17",
    cwd: "/opt/homebrew/var/postgresql@17",
    startedSecondsAgo: 79200,
  }),
  binding({
    port: 5432,
    family: "IPv6",
    address: "[::1]",
    pid: 51234,
    processName: "postgres",
    startedBy: "launchd",
    command:
      "/opt/homebrew/opt/postgresql@17/bin/postgres -D /opt/homebrew/var/postgresql@17",
    cwd: "/opt/homebrew/var/postgresql@17",
    startedSecondsAgo: 79200,
  }),

  // 6379 — Redis
  binding({
    port: 6379,
    address: "127.0.0.1",
    pid: 51100,
    processName: "redis-server",
    startedBy: "launchd",
    command: "/opt/homebrew/opt/redis/bin/redis-server 127.0.0.1:6379",
    cwd: "/opt/homebrew/var/db/redis",
    startedSecondsAgo: 79100,
  }),

  // 7897 / 9097 — Clash Verge 代理
  binding({
    port: 7897,
    address: "127.0.0.1",
    pid: 22505,
    processName: "verge-mihomo",
    startedBy: "clash-verge-service",
    command:
      "/Library/Application Support/clash-verge-service/cores/verge-mihomo -d /Users/peng.li/.config/clash-verge",
    cwd: "/Users/peng.li/.config/clash-verge",
    startedSecondsAgo: 6400,
  }),
  binding({
    port: 9097,
    address: "127.0.0.1",
    pid: 22505,
    processName: "verge-mihomo",
    startedBy: "clash-verge-service",
    command:
      "/Library/Application Support/clash-verge-service/cores/verge-mihomo -d /Users/peng.li/.config/clash-verge",
    cwd: "/Users/peng.li/.config/clash-verge",
    startedSecondsAgo: 6400,
  }),
  binding({
    port: 63040,
    address: "127.0.0.1",
    pid: 22445,
    processName: "clash-verge-service",
    startedBy: "launchd",
    command: "/Library/Application Support/clash-verge-service/clash-verge-service",
    cwd: "/Library/Application Support/clash-verge-service",
    startedSecondsAgo: 6400,
  }),

  // 5353 — mDNSResponder（UDP + TCP，对所有网卡开放）
  binding({
    port: 5353,
    protocol: "UDP",
    address: "*",
    pid: 225,
    processName: "mDNSResponder",
    startedBy: "launchd",
    command: "/usr/sbin/mDNSResponder",
    cwd: "/",
    startedSecondsAgo: 112000,
  }),
  binding({
    port: 5353,
    protocol: "UDP",
    family: "IPv6",
    address: "[::]",
    pid: 225,
    processName: "mDNSResponder",
    startedBy: "launchd",
    command: "/usr/sbin/mDNSResponder",
    cwd: "/",
    startedSecondsAgo: 112000,
  }),
  binding({
    port: 5353,
    family: "IPv6",
    address: "[::]",
    pid: 225,
    processName: "mDNSResponder",
    startedBy: "launchd",
    command: "/usr/sbin/mDNSResponder",
    cwd: "/",
    startedSecondsAgo: 112000,
  }),

  // 56574 — LANDrop 传输
  binding({
    port: 56574,
    family: "IPv6",
    address: "[::]",
    pid: 11742,
    processName: "LANDrop",
    startedBy: "launchd",
    command: "/Applications/LANDrop.app/Contents/MacOS/LANDrop",
    cwd: "/Applications/LANDrop.app/Contents/MacOS",
    startedSecondsAgo: 51000,
  }),

  // 7878 / 39393 — Freewind Remote Shell、Lan Chat 传输
  binding({
    port: 7878,
    family: "IPv6",
    address: "[::]",
    pid: 23343,
    processName: "FreewindRemoteShell",
    startedBy: "zsh",
    command: "node dist/server.js --port 7878",
    cwd: "/Users/peng.li/workspace/freewind-remote-shell",
    startedSecondsAgo: 3400,
  }),
  binding({
    port: 39393,
    family: "IPv6",
    address: "[::]",
    pid: 23343,
    processName: "FreewindRemoteShell",
    startedBy: "zsh",
    command: "node dist/server.js --port 39393",
    cwd: "/Users/peng.li/workspace/freewind-remote-shell",
    startedSecondsAgo: 3400,
  }),

  // 59011 / 54995 — 桌面应用的本地辅助端口
  binding({
    port: 59011,
    address: "127.0.0.1",
    pid: 4428,
    processName: "sandbox-c",
    startedBy: "Cursor",
    command: "/Applications/Cursor.app/Contents/Resources/app/bin/sandbox-c",
    cwd: "/Applications/Cursor.app/Contents/Resources/app",
    startedSecondsAgo: 2700,
  }),
  binding({
    port: 54995,
    address: "127.0.0.1",
    pid: 12776,
    processName: "Electron",
    startedBy: "Cursor",
    command:
      "/Applications/Cursor.app/Contents/MacOS/Cursor --type=utility --utility-sub-type=network.mojom.NetworkService",
    cwd: "/Applications/Cursor.app/Contents/MacOS",
    startedSecondsAgo: 11000,
  }),

  // 443 — 常见 HTTPS 出站连接
  binding({
    port: 443,
    address: "192.168.1.8:51822",
    state: "ESTABLISHED",
    peer: "142.250.72.14:443",
    pid: 18322,
    processName: "Google Chrome",
    startedBy: "Google Chrome",
    command:
      "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)",
    cwd: "/Applications/Google Chrome.app/Contents/MacOS",
    startedSecondsAgo: 9200,
  }),
  binding({
    port: 443,
    address: "192.168.1.8:60234",
    state: "ESTABLISHED",
    peer: "47.99.60.12:443",
    pid: 47373,
    processName: "curl",
    startedBy: "zsh",
    command:
      "curl -r 0-17999999 --limit-rate 200k https://mirrors.aliyun.com/ubuntu/ls-lR.gz",
    cwd: "/Users/peng.li",
    startedSecondsAgo: 180,
  }),

  // 22 — SSH 出站连接
  binding({
    port: 22,
    address: "192.168.1.8:60412",
    state: "ESTABLISHED",
    peer: "140.82.112.3:22",
    pid: 60012,
    processName: "ssh",
    startedBy: "zsh",
    command: "ssh -o ServerAliveInterval=60 git@github.com",
    cwd: "/Users/peng.li/workspace/freewind-mac-manager",
    startedSecondsAgo: 900,
  }),
]

/** 拉取端口绑定的异步入口；接后端时替换为 `@shared/client-api` 的调用。 */
export const fetchPortBindings = async (): Promise<PortBinding[]> =>
  mockPortBindings

/** 按端口聚合套接字绑定，同一端口的多条记录（双栈、多进程）合成一组。 */
export const buildPortGroups = (bindings: PortBinding[]): PortGroup[] => {
  const byPort = new Map<number, PortBinding[]>()
  for (const item of bindings) {
    const list = byPort.get(item.port)
    if (list) {
      list.push(item)
    } else {
      byPort.set(item.port, [item])
    }
  }

  return [...byPort.entries()].map(([port, items]) => {
    const service = describePort(port)
    return {
      port,
      service,
      category: service.category,
      exposed: items.some(
        (item) => item.state === "LISTEN" && isExposedAddress(item.address)
      ),
      protocols: [...new Set(items.map((item) => item.protocol))],
      addresses: [...new Set(items.map((item) => item.address))],
      processNames: [...new Set(items.map((item) => item.processName))],
      pids: [...new Set(items.map((item) => item.pid))],
      starters: [...new Set(items.map((item) => item.startedBy))],
      state: items.some((item) => item.state === "LISTEN")
        ? "LISTEN"
        : items[0].state,
      bindings: items,
    }
  })
}
