import { create } from "zustand"

export type DiskGrowthView = "growth" | "size" | "icicle"
export type DiskGrowthSortKey = "name" | "size" | "delta"

/**
 * 磁盘增长页里「跨组件共享的本地状态」集中放这里（Zustand）；
 * 只影响单个组件的状态（对话框开关、hover）留在 React state。
 */
type DiskGrowthState = {
  view: DiskGrowthView
  sortKey: DiskGrowthSortKey
  descending: boolean
  /** 已展开的目录路径。 */
  expanded: string[]
  /** 快照区间端点（最多两个）。 */
  selection: number[]
  multiSelect: boolean
  /** 多选模式下勾选到的快照 id（始终是连续区间）。 */
  checked: number[]
  /** 多选锚点：快照在列表中的下标。 */
  anchorIndex: number | null
  /** 分布图的当前根与返回栈。 */
  focusPath: string
  focusStack: string[]
  keyword: string

  setView: (view: DiskGrowthView) => void
  setSort: (key: DiskGrowthSortKey) => void
  toggleExpanded: (path: string) => void
  collapseAll: () => void
  setSelection: (ids: number[]) => void
  setMultiSelect: (on: boolean) => void
  setChecked: (ids: number[]) => void
  setAnchorIndex: (index: number | null) => void
  enterFocus: (path: string) => void
  leaveFocus: () => void
  setKeyword: (keyword: string) => void
  resetForNewSnapshot: () => void
}

const DEFAULT_SORT: Record<DiskGrowthView, DiskGrowthSortKey> = {
  growth: "delta",
  size: "size",
  icicle: "size",
}

export const useDiskGrowthStore = create<DiskGrowthState>((set) => ({
  view: "growth",
  sortKey: "delta",
  descending: true,
  expanded: [""],
  selection: [],
  multiSelect: false,
  checked: [],
  anchorIndex: null,
  focusPath: "",
  focusStack: [],
  keyword: "",

  setView: (view) =>
    set({ view, sortKey: DEFAULT_SORT[view], descending: true }),

  setSort: (key) =>
    set((state) =>
      state.sortKey === key
        ? { descending: !state.descending }
        : { sortKey: key, descending: true }
    ),

  toggleExpanded: (path) =>
    set((state) => {
      if (state.expanded.includes(path)) {
        return {
          expanded: state.expanded.filter(
            (item) => item !== path && !item.startsWith(`${path}/`)
          ),
        }
      }
      return { expanded: [...state.expanded, path] }
    }),

  collapseAll: () => set({ expanded: [""] }),

  setSelection: (ids) => set({ selection: ids }),

  setMultiSelect: (on) =>
    set(
      on
        ? { multiSelect: true }
        : { multiSelect: false, checked: [], anchorIndex: null, selection: [] }
    ),

  setChecked: (ids) => set({ checked: ids }),

  setAnchorIndex: (index) => set({ anchorIndex: index }),

  enterFocus: (path) =>
    set((state) => ({
      focusStack: [...state.focusStack, state.focusPath],
      focusPath: path,
    })),

  leaveFocus: () =>
    set((state) => {
      const stack = [...state.focusStack]
      const previous = stack.pop() ?? ""
      return { focusPath: previous, focusStack: stack }
    }),

  setKeyword: (keyword) => set({ keyword }),

  resetForNewSnapshot: () =>
    set({
      expanded: [""],
      selection: [],
      checked: [],
      multiSelect: false,
      anchorIndex: null,
      focusPath: "",
      focusStack: [],
    }),
}))
