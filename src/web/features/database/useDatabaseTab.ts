import { useSyncExternalStore } from "react"

/** 数据库页的两个视图：数据是主从浏览，备份是备份列表、创建导入下载与恢复入口。 */
export const DATABASE_TABS = [
  { key: "data", label: "数据" },
  { key: "backups", label: "备份" },
] as const

export type DatabaseTab = (typeof DATABASE_TABS)[number]["key"]

export const DEFAULT_DATABASE_TAB: DatabaseTab = "data"

const TAB_KEYS: readonly string[] = DATABASE_TABS.map((item) => item.key)

export const databaseTabFromUrl = (): DatabaseTab => {
  if (typeof window === "undefined") return DEFAULT_DATABASE_TAB
  const value = new URL(window.location.href).searchParams.get("tab")
  return value && TAB_KEYS.includes(value)
    ? (value as DatabaseTab)
    : DEFAULT_DATABASE_TAB
}

const databaseTabUrl = (tab: DatabaseTab): URL => {
  const url = new URL(window.location.href)
  if (tab === DEFAULT_DATABASE_TAB) url.searchParams.delete("tab")
  else url.searchParams.set("tab", tab)
  return url
}

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener("popstate", onChange)
  return () => window.removeEventListener("popstate", onChange)
}

const snapshot = (): string => databaseTabFromUrl()

/**
 * 视图状态放 URL，而不是全局 store：
 * 刷新、分享链接与浏览器返回都能恢复到原视图；参数名与 Docker 页一致（tab），
 * 但只认 data/backups 两个值，未知值（例如 Docker 的分区名）安全回退到数据。
 */
export const useDatabaseTab = (): {
  tab: DatabaseTab
  selectTab: (tab: DatabaseTab) => void
} => {
  const tab = useSyncExternalStore(
    subscribe,
    snapshot,
    () => DEFAULT_DATABASE_TAB
  ) as DatabaseTab

  return {
    tab,
    selectTab: (next: DatabaseTab): void => {
      if (next === tab) return
      // 保留已有历史状态标记，App 的返回按钮才认得这是应用内导航
      window.history.pushState(
        { ...window.history.state, macManagerFeature: true },
        "",
        databaseTabUrl(next)
      )
      window.dispatchEvent(new PopStateEvent("popstate"))
    },
  }
}
