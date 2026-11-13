import { useSyncExternalStore } from "react"

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener("popstate", onChange)
  return () => window.removeEventListener("popstate", onChange)
}

const readTab = <Tab extends string>(
  param: string,
  tabs: readonly Tab[],
  fallback: Tab
): Tab => {
  if (typeof window === "undefined") return fallback
  const value = new URL(window.location.href).searchParams.get(param)
  return value && tabs.includes(value as Tab) ? (value as Tab) : fallback
}

/**
 * 把「当前分区」放进 URL 查询参数：刷新、分享链接与浏览器返回都能恢复原分区。
 * 只覆盖「单参数、合法值之外回落 fallback」的同构分区；带额外深链语义的分区
 * （如 Pi 页的 piRun）读写规则不同，不适用本 hook，应保留自己的读写逻辑。
 */
export const useUrlTab = <Tab extends string>(
  param: string,
  tabs: readonly Tab[],
  fallback: Tab
): { tab: Tab; selectTab: (tab: Tab) => void } => {
  const tab = useSyncExternalStore(
    subscribe,
    () => readTab(param, tabs, fallback),
    () => fallback
  )

  return {
    tab,
    selectTab: (next: Tab): void => {
      if (next === tab) return
      const url = new URL(window.location.href)
      if (next === fallback) url.searchParams.delete(param)
      else url.searchParams.set(param, next)
      // 保留已有历史状态标记，App 的返回按钮才认得这是应用内导航
      window.history.pushState(
        { ...window.history.state, computerManagerFeature: true },
        "",
        url
      )
      window.dispatchEvent(new PopStateEvent("popstate"))
    },
  }
}
