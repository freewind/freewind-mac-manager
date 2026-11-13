import { useUrlTab } from "@web/hooks/use-url-tab"

/** 数据库页的两个视图：数据是主从浏览，备份是备份列表、创建导入下载与恢复入口。 */
export const DATABASE_TABS = [
  { key: "data", label: "数据" },
  { key: "backups", label: "备份" },
] as const

export type DatabaseTab = (typeof DATABASE_TABS)[number]["key"]

const DEFAULT_DATABASE_TAB: DatabaseTab = "data"

const TAB_KEYS: readonly DatabaseTab[] = DATABASE_TABS.map((item) => item.key)

/**
 * 视图状态放 URL，而不是全局 store：
 * 刷新、分享链接与浏览器返回都能恢复到原视图；参数名与 Docker 页一致（tab），
 * 但只认 data/backups 两个值，未知值（例如 Docker 的分区名）安全回退到数据。
 */
export const useDatabaseTab = (): {
  tab: DatabaseTab
  selectTab: (tab: DatabaseTab) => void
} => useUrlTab("tab", TAB_KEYS, DEFAULT_DATABASE_TAB)
