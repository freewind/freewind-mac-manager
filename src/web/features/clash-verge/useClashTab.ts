import { useSyncExternalStore } from "react"

/** Clash 页的主体分区：状态快照、订阅信息、合并订阅、代理组与活动连接。 */
export const CLASH_TABS = [
  { key: "status", label: "状态" },
  { key: "profiles", label: "订阅信息" },
  { key: "merge", label: "合并订阅" },
  { key: "proxies", label: "代理组" },
  { key: "connections", label: "活动连接" },
] as const

export type ClashTab = (typeof CLASH_TABS)[number]["key"]

export const DEFAULT_CLASH_TAB: ClashTab = "status"

const TAB_KEYS: readonly string[] = CLASH_TABS.map((item) => item.key)

export const clashTabFromUrl = (): ClashTab => {
  if (typeof window === "undefined") return DEFAULT_CLASH_TAB
  const value = new URL(window.location.href).searchParams.get("clashTab")
  return value && TAB_KEYS.includes(value)
    ? (value as ClashTab)
    : DEFAULT_CLASH_TAB
}

const clashTabUrl = (tab: ClashTab): URL => {
  const url = new URL(window.location.href)
  if (tab === DEFAULT_CLASH_TAB) url.searchParams.delete("clashTab")
  else url.searchParams.set("clashTab", tab)
  return url
}

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener("popstate", onChange)
  return () => window.removeEventListener("popstate", onChange)
}

const snapshot = (): string => clashTabFromUrl()

/**
 * 分区状态放 URL，而不是全局 store：
 * 刷新、分享链接与浏览器返回都能恢复到原分区；
 * 参数名用 clashTab，避免与 caddyTab、piTab、Docker 的 tab 互相干扰。
 */
export const useClashTab = (): {
  tab: ClashTab
  selectTab: (tab: ClashTab) => void
} => {
  const tab = useSyncExternalStore(
    subscribe,
    snapshot,
    () => DEFAULT_CLASH_TAB
  ) as ClashTab

  return {
    tab,
    selectTab: (next: ClashTab): void => {
      if (next === tab) return
      // 保留已有历史状态标记，App 的返回按钮才认得这是应用内导航
      window.history.pushState(
        { ...window.history.state, macManagerFeature: true },
        "",
        clashTabUrl(next)
      )
      window.dispatchEvent(new PopStateEvent("popstate"))
    },
  }
}
