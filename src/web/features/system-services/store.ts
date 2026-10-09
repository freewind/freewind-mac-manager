import { create } from "zustand"
import type { ServiceDomain, ServiceState } from "@shared/api-contract"

export type StateFilter = "all" | ServiceState
export type DomainFilter = "all" | ServiceDomain

type SystemServicesLocalState = {
  /** 当前选中的服务 label */
  selectedLabel: string | null
  keyword: string
  stateFilter: StateFilter
  domainFilter: DomainFilter

  selectService: (label: string) => void
  setKeyword: (keyword: string) => void
  setStateFilter: (filter: StateFilter) => void
  setDomainFilter: (filter: DomainFilter) => void
}

/** 只放界面自己的共享状态；服务数据一律由 TanStack Query 管。 */
export const useSystemServicesLocalStore = create<SystemServicesLocalState>(
  (set) => ({
    selectedLabel: null,
    keyword: "",
    stateFilter: "all",
    domainFilter: "all",

    selectService: (label) => set({ selectedLabel: label }),
    setKeyword: (keyword) => set({ keyword }),
    setStateFilter: (stateFilter) => set({ stateFilter }),
    setDomainFilter: (domainFilter) => set({ domainFilter }),
  })
)
