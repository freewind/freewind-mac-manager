import { useUrlTab } from "@web/hooks/use-url-tab"

/** Clash 页的主体分区：状态（含代理组与活动连接）、订阅信息、合并订阅、域名规则、规则数据库与配置详解。 */
export const CLASH_TABS = [
  { key: "status", label: "状态" },
  { key: "profiles", label: "订阅信息" },
  { key: "merge", label: "合并订阅" },
  { key: "customRules", label: "域名规则" },
  // 代理组与活动连接是状态页里的两张卡片，不再单独占标签。
  { key: "geoData", label: "规则数据库" },
  { key: "config", label: "配置详解" },
] as const

export type ClashTab = (typeof CLASH_TABS)[number]["key"]

const DEFAULT_CLASH_TAB: ClashTab = "status"

const TAB_KEYS: readonly ClashTab[] = CLASH_TABS.map((item) => item.key)

/**
 * 分区状态放 URL，而不是全局 store：
 * 刷新、分享链接与浏览器返回都能恢复到原分区；
 * 参数名用 clashTab，避免与 caddyTab、piTab、Docker 的 tab 互相干扰。
 */
export const useClashTab = (): {
  tab: ClashTab
  selectTab: (tab: ClashTab) => void
} => useUrlTab("clashTab", TAB_KEYS, DEFAULT_CLASH_TAB)
