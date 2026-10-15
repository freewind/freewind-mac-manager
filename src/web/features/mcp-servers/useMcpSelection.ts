import { useSyncExternalStore } from "react"

/** 服务器详情里的分区。 */
export const MCP_TABS = [
  { key: "tools", label: "工具" },
  { key: "resources", label: "资源" },
  { key: "prompts", label: "提示词" },
  { key: "records", label: "调用记录" },
] as const

export type McpTab = (typeof MCP_TABS)[number]["key"]

export const DEFAULT_MCP_TAB: McpTab = "tools"

const TAB_KEYS: readonly string[] = MCP_TABS.map((item) => item.key)

const readParams = (): { serverId: string | null; tab: McpTab } => {
  if (typeof window === "undefined") {
    return { serverId: null, tab: DEFAULT_MCP_TAB }
  }
  const params = new URL(window.location.href).searchParams
  const tab = params.get("mcpTab")
  return {
    serverId: params.get("mcpServer"),
    tab: tab && TAB_KEYS.includes(tab) ? (tab as McpTab) : DEFAULT_MCP_TAB,
  }
}

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener("popstate", onChange)
  return () => window.removeEventListener("popstate", onChange)
}

const snapshot = (): string => {
  const { serverId, tab } = readParams()
  return `${serverId ?? ""}\u0000${tab}`
}

const push = (mutate: (params: URLSearchParams) => void): void => {
  const url = new URL(window.location.href)
  mutate(url.searchParams)
  // 保留已有历史状态标记，App 的返回按钮才认得这是应用内导航。
  window.history.pushState(
    { ...window.history.state, macManagerFeature: true },
    "",
    url
  )
  window.dispatchEvent(new PopStateEvent("popstate"))
}

/**
 * 当前选中的服务器与详情分区。
 *
 * 都放在 URL 里而不是全局 store：刷新、分享链接与手机系统返回都能恢复到
 * 原来的位置；手机上「返回」先回到服务器列表，而不是直接离开页面。
 */
export const useMcpSelection = (): {
  serverId: string | null
  tab: McpTab
  selectServer: (serverId: string | null) => void
  selectTab: (tab: McpTab) => void
} => {
  const current = useSyncExternalStore(subscribe, snapshot, () => "\u0000tools")
  const [rawServerId, tab] = current.split("\u0000")
  const serverId = rawServerId === "" ? null : rawServerId

  return {
    serverId,
    tab: tab as McpTab,
    selectServer: (next: string | null): void => {
      if (next === serverId) return
      push((params) => {
        if (next === null) params.delete("mcpServer")
        else params.set("mcpServer", next)
        // 换服务器时回到第一个分区，避免停在上一台没有的分区上。
        params.delete("mcpTab")
      })
    },
    selectTab: (next: McpTab): void => {
      if (next === tab) return
      push((params) => {
        if (next === DEFAULT_MCP_TAB) params.delete("mcpTab")
        else params.set("mcpTab", next)
      })
    },
  }
}
