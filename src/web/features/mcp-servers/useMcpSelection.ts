import { useNavigate, useSearch } from "@tanstack/react-router"

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
  const search = useSearch({ strict: false }) as Record<
    string,
    string | undefined
  >
  const navigate = useNavigate()
  const serverId = search.mcpServer ?? null
  const tab: McpTab =
    search.mcpTab && TAB_KEYS.includes(search.mcpTab)
      ? (search.mcpTab as McpTab)
      : DEFAULT_MCP_TAB

  return {
    serverId,
    tab,
    selectServer: (next: string | null): void => {
      if (next === serverId) return
      void navigate({
        to: ".",
        search: (prev: Record<string, string | undefined>) => ({
          ...prev,
          mcpServer: next ?? undefined,
          // 换服务器时回到第一个分区，避免停在上一台没有的分区上。
          mcpTab: undefined,
        }),
      })
    },
    selectTab: (next: McpTab): void => {
      if (next === tab) return
      void navigate({
        to: ".",
        search: (prev: Record<string, string | undefined>) => ({
          ...prev,
          // 默认分区不写进 URL。
          mcpTab: next === DEFAULT_MCP_TAB ? undefined : next,
        }),
      })
    },
  }
}
