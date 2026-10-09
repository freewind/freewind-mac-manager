import { create } from "zustand"

/** 快照列表里的「实时」项：始终展示当前正在跑的进程与实时速率。 */
export const REALTIME_SNAPSHOT_ID = "realtime"

/** 默认忽略的代理进程：经代理的流量会同时记在它们的名下。 */
export const ignoredProxyNames = [
  "verge-mihomo",
  "clash-verge",
  "clash",
  "mihomo",
]

type TrafficLocalState = {
  /** 当前选中的快照；多选时是连续的一段。实时用 REALTIME_SNAPSHOT_ID 表示 */
  selectedIds: string[]
  /** 多选模式：列表左侧显示复选框，并出现批量操作 */
  selectionMode: boolean
  /** 展开的进程名 */
  expandedNames: string[]
  /** 是否忽略代理进程 */
  ignoreProxy: boolean
  /** 当前选中的表格行 */
  selectedRowKey: string | null

  setSelectedIds: (ids: string[]) => void
  setSelectionMode: (enabled: boolean) => void
  toggleExpanded: (name: string) => void
  setIgnoreProxy: (value: boolean) => void
  selectRow: (key: string | null) => void
}

/** 只放界面自己的共享状态；数据一律由 TanStack Query 管。 */
export const useTrafficLocalStore = create<TrafficLocalState>((set) => ({
  selectedIds: [REALTIME_SNAPSHOT_ID],
  selectionMode: false,
  expandedNames: ["node"],
  ignoreProxy: true,
  selectedRowKey: null,

  setSelectedIds: (ids) => set({ selectedIds: ids }),
  setSelectionMode: (enabled) => set({ selectionMode: enabled }),
  toggleExpanded: (name) =>
    set((state) => ({
      expandedNames: state.expandedNames.includes(name)
        ? state.expandedNames.filter((item) => item !== name)
        : [...state.expandedNames, name],
    })),
  setIgnoreProxy: (value) => set({ ignoreProxy: value }),
  selectRow: (key) => set({ selectedRowKey: key }),
}))
