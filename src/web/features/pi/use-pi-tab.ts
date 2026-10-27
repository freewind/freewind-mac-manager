import { useSyncExternalStore } from "react"

/** Pi 页的分区；AI助手是助手域在 Pi 页的入口。 */
export const PI_TABS = [
  "models",
  "history",
  "settings",
  "probe",
  "chat",
  "assistant",
] as const

export type PiTab = (typeof PI_TABS)[number]

export const DEFAULT_PI_TAB: PiTab = "models"

/** AI 助手设置所在的子标签：浮层里的「去设置模型」定位到这里。 */
export const AI_ASSISTANT_PI_TAB: PiTab = "assistant"

const TAB_KEYS: readonly string[] = PI_TABS

export const piTabFromUrl = (): PiTab => {
  if (typeof window === "undefined") return DEFAULT_PI_TAB
  const params = new URL(window.location.href).searchParams
  const value = params.get("piTab")
  if (value && TAB_KEYS.includes(value)) return value as PiTab
  // 兼容既有深链：带 piRun 的链接仍然直接落到 Playground。
  return params.get("piRun") ? "chat" : DEFAULT_PI_TAB
}

const piTabUrl = (tab: PiTab): URL => {
  const url = new URL(window.location.href)
  // 带运行深链时必须显式指定模型页，否则解析会再次回落到 Playground。
  if (tab === DEFAULT_PI_TAB && !url.searchParams.get("piRun")) {
    url.searchParams.delete("piTab")
  } else {
    url.searchParams.set("piTab", tab)
  }
  return url
}

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener("popstate", onChange)
  return () => window.removeEventListener("popstate", onChange)
}

const snapshot = (): string => piTabFromUrl()

/**
 * 分区状态放 URL，而不是组件内部 state：
 * 刷新、分享链接、浏览器返回，以及从 AI 助手浮层跳过来，都能定位到正确分区。
 */
export const usePiTab = (): {
  tab: PiTab
  selectTab: (tab: PiTab) => void
} => {
  const tab = useSyncExternalStore(
    subscribe,
    snapshot,
    () => DEFAULT_PI_TAB
  ) as PiTab

  return {
    tab,
    selectTab: (next: PiTab): void => {
      if (next === tab) return
      // 保留既有历史状态标记，App 的返回按钮才认得这是应用内导航。
      window.history.pushState(
        { ...window.history.state, macManagerFeature: true },
        "",
        piTabUrl(next)
      )
      window.dispatchEvent(new PopStateEvent("popstate"))
    },
  }
}
