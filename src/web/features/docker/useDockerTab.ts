import { useUrlTab } from "@web/hooks/use-url-tab"

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
const DEFAULT_DOCKER_TAB: DockerTab = "containers"

const TAB_KEYS: readonly DockerTab[] = DOCKER_TABS.map((item) => item.key)

/**
 * 分区状态放 URL，而不是全局 store：
 * 刷新、分享链接与浏览器返回都能恢复到原分区。
 */
export const useDockerTab = (): {
  tab: DockerTab
  selectTab: (tab: DockerTab) => void
} => useUrlTab("tab", TAB_KEYS, DEFAULT_DOCKER_TAB)
