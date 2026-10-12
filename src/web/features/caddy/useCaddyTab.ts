import { useSyncExternalStore } from "react"

/** Caddy 页的主体分区：规则、变更预览与版本历史各自一个滚动区。 */
export const CADDY_TABS = [
  { key: "rules", label: "规则" },
  { key: "preview", label: "变更预览" },
  { key: "versions", label: "版本历史" },
] as const

export type CaddyTab = (typeof CADDY_TABS)[number]["key"]

export const DEFAULT_CADDY_TAB: CaddyTab = "rules"

const TAB_KEYS: readonly string[] = CADDY_TABS.map((item) => item.key)

export const caddyTabFromUrl = (): CaddyTab => {
  if (typeof window === "undefined") return DEFAULT_CADDY_TAB
  const value = new URL(window.location.href).searchParams.get("caddyTab")
  return value && TAB_KEYS.includes(value)
    ? (value as CaddyTab)
    : DEFAULT_CADDY_TAB
}

const caddyTabUrl = (tab: CaddyTab): URL => {
  const url = new URL(window.location.href)
  if (tab === DEFAULT_CADDY_TAB) url.searchParams.delete("caddyTab")
  else url.searchParams.set("caddyTab", tab)
  return url
}

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener("popstate", onChange)
  return () => window.removeEventListener("popstate", onChange)
}

const snapshot = (): string => caddyTabFromUrl()

/**
 * 分区状态放 URL，而不是全局 store：
 * 刷新、分享链接与浏览器返回都能恢复到原分区；
 * 参数名用 caddyTab，避免与 Docker 页的 tab 互相干扰。
 */
export const useCaddyTab = (): {
  tab: CaddyTab
  selectTab: (tab: CaddyTab) => void
} => {
  const tab = useSyncExternalStore(
    subscribe,
    snapshot,
    () => DEFAULT_CADDY_TAB
  ) as CaddyTab

  return {
    tab,
    selectTab: (next: CaddyTab): void => {
      if (next === tab) return
      // 保留已有历史状态标记，App 的返回按钮才认得这是应用内导航
      window.history.pushState(
        { ...window.history.state, macManagerFeature: true },
        "",
        caddyTabUrl(next)
      )
      window.dispatchEvent(new PopStateEvent("popstate"))
    },
  }
}
