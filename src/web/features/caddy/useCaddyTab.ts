import { useUrlTab } from "@web/hooks/use-url-tab"

/** Caddy 页的主体分区：规则、变更预览与版本历史各自一个滚动区。 */
export const CADDY_TABS = [
  { key: "rules", label: "规则" },
  { key: "preview", label: "变更预览" },
  { key: "versions", label: "版本历史" },
] as const

export type CaddyTab = (typeof CADDY_TABS)[number]["key"]

const DEFAULT_CADDY_TAB: CaddyTab = "rules"

const TAB_KEYS: readonly CaddyTab[] = CADDY_TABS.map((item) => item.key)

/**
 * 分区状态放 URL，而不是全局 store：
 * 刷新、分享链接与浏览器返回都能恢复到原分区；
 * 参数名用 caddyTab，避免与 Docker 页的 tab 互相干扰。
 */
export const useCaddyTab = (): {
  tab: CaddyTab
  selectTab: (tab: CaddyTab) => void
} => useUrlTab("caddyTab", TAB_KEYS, DEFAULT_CADDY_TAB)
