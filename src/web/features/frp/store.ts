import { create } from "zustand"
import type { FrpProbe, FrpProxyType } from "@web/features/frp/mock-data"

export type FrpTypeFilter = "all" | FrpProxyType

/**
 * FRP 页里「跨组件共享的本地状态」集中放这里（Zustand）。
 * 远程配置由 TanStack Query 管；只影响单个组件的状态（弹窗开关、表单字段）留在 React state。
 */
type FrpLocalState = {
  search: string
  typeFilter: FrpTypeFilter
  selectedName: string | null
  /** 各隧道的探测结果，key 为隧道名。 */
  probes: Record<string, FrpProbe>
  /** 正在探测中的隧道名。 */
  checking: string[]

  setSearch: (search: string) => void
  setTypeFilter: (filter: FrpTypeFilter) => void
  select: (name: string | null) => void
  setProbe: (name: string, probe: FrpProbe) => void
  clearProbe: (name: string) => void
  setChecking: (name: string, checking: boolean) => void
}

export const useFrpLocalStore = create<FrpLocalState>((set) => ({
  search: "",
  typeFilter: "all",
  selectedName: null,
  probes: {},
  checking: [],

  setSearch: (search) => set({ search }),

  setTypeFilter: (typeFilter) => set({ typeFilter }),

  select: (selectedName) => set({ selectedName }),

  setProbe: (name, probe) =>
    set((state) => ({ probes: { ...state.probes, [name]: probe } })),

  clearProbe: (name) =>
    set((state) => {
      const probes = { ...state.probes }
      delete probes[name]
      return { probes }
    }),

  setChecking: (name, checking) =>
    set((state) => ({
      checking: checking
        ? [...new Set([...state.checking, name])]
        : state.checking.filter((item) => item !== name),
    })),
}))
