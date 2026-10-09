import type { PortBinding } from "@shared/api-contract"

export type PortProtocol = PortBinding["protocol"]
export type PortState = PortBinding["state"]
export type PortFamily = PortBinding["family"]

/** 端口归属分类，用于左侧快捷视图。 */
export type PortCategory = "dev" | "database" | "proxy" | "system" | "app"

export type PortService = {
  label: string
  category: PortCategory
}

/** 同一端口的多条套接字绑定聚合后的一行。 */
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
