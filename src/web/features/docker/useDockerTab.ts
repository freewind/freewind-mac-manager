import { useSyncExternalStore } from "react"

/** Docker 页的分区：概览是 Colima 与资源计数汇总，其余四个按资源类型划分。 */
export const DOCKER_TABS = [
  { key: "overview", label: "概览" },
  { key: "containers", label: "容器" },
  { key: "images", label: "镜像" },
  { key: "volumes", label: "卷" },
  { key: "networks", label: "网络" },
] as const

export type DockerTab = (typeof DOCKER_TABS)[number]["key"]

/** 默认停在容器：最常用的操作直接可见，概览在标签里随时可切。 */
export const DEFAULT_DOCKER_TAB: DockerTab = "containers"

const TAB_KEYS: readonly string[] = DOCKER_TABS.map((item) => item.key)

export const dockerTabFromUrl = (): DockerTab => {
  if (typeof window === "undefined") return DEFAULT_DOCKER_TAB
  const value = new URL(window.location.href).searchParams.get("tab")
  return value && TAB_KEYS.includes(value)
    ? (value as DockerTab)
    : DEFAULT_DOCKER_TAB
}

const dockerTabUrl = (tab: DockerTab): URL => {
  const url = new URL(window.location.href)
  if (tab === DEFAULT_DOCKER_TAB) url.searchParams.delete("tab")
  else url.searchParams.set("tab", tab)
  return url
}

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener("popstate", onChange)
  return () => window.removeEventListener("popstate", onChange)
}

const snapshot = (): string => dockerTabFromUrl()

/**
 * 分区状态放 URL，而不是全局 store：
 * 刷新、分享链接与浏览器返回都能恢复到原分区。
 */
export const useDockerTab = (): {
  tab: DockerTab
  selectTab: (tab: DockerTab) => void
} => {
  const tab = useSyncExternalStore(
    subscribe,
    snapshot,
    () => DEFAULT_DOCKER_TAB
  ) as DockerTab

  return {
    tab,
    selectTab: (next: DockerTab): void => {
      if (next === tab) return
      // 保留已有历史状态标记，App 的返回按钮才认得这是应用内导航
      window.history.pushState(
        { ...window.history.state, macManagerFeature: true },
        "",
        dockerTabUrl(next)
      )
      window.dispatchEvent(new PopStateEvent("popstate"))
    },
  }
}
