import { create } from "zustand"
import type { PortCategory, PortProtocol } from "@web/features/ports/mock-data"

/** 左侧快捷视图：状态、暴露面与分类的快捷筛选。 */
export type PortView =
  | "all"
  | "listening"
  | "connected"
  | "exposed"
  | PortCategory

export const PORT_VIEWS: { key: PortView; label: string }[] = [
  { key: "all", label: "全部端口" },
  { key: "listening", label: "监听中" },
  { key: "connected", label: "已建立连接" },
  { key: "exposed", label: "对外暴露" },
  { key: "dev", label: "开发服务" },
  { key: "database", label: "数据库" },
  { key: "proxy", label: "代理 / 网关" },
  { key: "system", label: "系统进程" },
  { key: "app", label: "其他应用" },
]

export type PortProtocolFilter = "all" | PortProtocol
export type PortScopeFilter = "all" | "listening" | "connected"
export type PortExposureFilter = "all" | "local" | "exposed"

/** 自动刷新间隔（秒），也作为 TanStack Query 的 refetchInterval。 */
export const REFRESH_INTERVAL_SECONDS = 5

/**
 * 端口管理页里「跨组件共享的本地状态」集中放这里（Zustand）。
 * 远程数据统一由 TanStack Query 管；只影响单个组件的状态（表格排序、确认弹窗）留在 React state。
 */
type PortsState = {
  view: PortView
  search: string
  protocol: PortProtocolFilter
  scope: PortScopeFilter
  exposure: PortExposureFilter
  /** 已展开的端口号。 */
  expandedPorts: number[]
  /** 当前选中的表格行（端口号）。 */
  selectedPort: number | null
  /** 自动刷新开关。 */
  autoRefresh: boolean

  setView: (view: PortView) => void
  setSearch: (search: string) => void
  setProtocol: (protocol: PortProtocolFilter) => void
  setScope: (scope: PortScopeFilter) => void
  setExposure: (exposure: PortExposureFilter) => void
  toggleExpanded: (port: number) => void
  selectPort: (port: number | null) => void
  setAutoRefresh: (enabled: boolean) => void
}

export const usePortsLocalStore = create<PortsState>((set) => ({
  view: "all",
  search: "",
  protocol: "all",
  scope: "all",
  exposure: "all",
  expandedPorts: [5173],
  selectedPort: null,
  autoRefresh: true,

  setView: (view) => set({ view }),
  setSearch: (search) => set({ search }),
  setProtocol: (protocol) => set({ protocol }),
  setScope: (scope) => set({ scope }),
  setExposure: (exposure) => set({ exposure }),
  toggleExpanded: (port) =>
    set((state) => ({
      expandedPorts: state.expandedPorts.includes(port)
        ? state.expandedPorts.filter((item) => item !== port)
        : [...state.expandedPorts, port],
    })),
  selectPort: (port) => set({ selectedPort: port }),
  setAutoRefresh: (enabled) => set({ autoRefresh: enabled }),
}))
