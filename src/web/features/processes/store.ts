import { create } from "zustand"

/** 自动刷新间隔（秒），也作为 TanStack Query 的 refetchInterval。 */
export const REFRESH_INTERVAL_SECONDS = 2

/** 进程范围筛选。 */
export type ProcessScope = "all" | "mine" | "system" | "ports"

export const PROCESS_SCOPES: { key: ProcessScope; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "mine", label: "我的进程" },
  { key: "system", label: "系统进程" },
  { key: "ports", label: "占用端口" },
]

/**
 * 进程管理页里「跨组件共享的本地状态」集中放这里（Zustand）。
 * 远程数据统一由 TanStack Query 管；只影响单个组件的状态（表格排序、确认弹窗）留在 React state。
 */
type ProcessesState = {
  scope: ProcessScope
  search: string
  /** 自动刷新开关，同时决定采样查询的 refetchInterval。 */
  autoRefresh: boolean
  /** 勾选的进程 PID。 */
  checkedPids: number[]
  /** 详情抽屉里展示的进程 PID。 */
  selectedPid: number | null

  setScope: (scope: ProcessScope) => void
  setSearch: (search: string) => void
  setAutoRefresh: (enabled: boolean) => void
  toggleChecked: (pid: number, checked: boolean) => void
  setChecked: (pids: number[]) => void
  selectProcess: (pid: number | null) => void
}

export const useProcessesLocalStore = create<ProcessesState>((set) => ({
  scope: "all",
  search: "",
  autoRefresh: true,
  checkedPids: [],
  selectedPid: null,

  setScope: (scope) => set({ scope }),
  setSearch: (search) => set({ search }),
  setAutoRefresh: (autoRefresh) => set({ autoRefresh }),
  toggleChecked: (pid, checked) =>
    set((state) => ({
      checkedPids: checked
        ? state.checkedPids.includes(pid)
          ? state.checkedPids
          : [...state.checkedPids, pid]
        : state.checkedPids.filter((item) => item !== pid),
    })),
  setChecked: (checkedPids) => set({ checkedPids }),
  selectProcess: (selectedPid) => set({ selectedPid }),
}))
