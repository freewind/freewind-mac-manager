import { create } from "zustand"

export type ProcessSortKey = "name" | "cpu" | "memory"

/**
 * 概览页里「跨组件共享的本地状态」集中放这里（Zustand）。
 *
 * 只影响单个组件、不跨组件读写的状态（比如展开开关、hover）留在 React state；
 * 服务端数据一律由 TanStack Query 管，不放这里。
 */
type DashboardLocalState = {
  /** 暂停自动刷新；暂停期间所有 query 都不再轮询。 */
  paused: boolean
  processSortKey: ProcessSortKey
  processDescending: boolean

  setPaused: (paused: boolean) => void
  togglePaused: () => void
  setProcessSort: (key: ProcessSortKey) => void
}

export const useDashboardLocalStore = create<DashboardLocalState>((set) => ({
  paused: false,
  processSortKey: "cpu",
  processDescending: true,

  setPaused: (paused) => set({ paused }),
  togglePaused: () => set((state) => ({ paused: !state.paused })),
  setProcessSort: (key) =>
    set((state) =>
      state.processSortKey === key
        ? { processDescending: !state.processDescending }
        : { processSortKey: key, processDescending: true }
    ),
}))
