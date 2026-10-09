import { create } from "zustand"
import { isDescendantPath } from "@web/features/files/domain"

/**
 * 文件管理页里「跨组件共享的本地状态」集中放这里（Zustand）。
 *
 * 远程数据统一由 TanStack Query 管；只影响单个组件的状态（表格排序、弹窗开关）留在 React state。
 */
type FilesLocalState = {
  /**
   * 当前目录。空字符串表示「还没定位到根」，服务端会把空串解析成真实根路径；
   * 树根与面包屑都用服务端返回的根路径，不猜。
   */
  currentPath: string
  /** 目录树里已展开的路径。 */
  expanded: string[]
  /** 文件表里勾选的条目路径。 */
  selected: string[]

  setCurrentPath: (path: string) => void
  enterDirectory: (rootPath: string, path: string) => void
  toggleExpanded: (path: string) => void
  expandAncestors: (rootPath: string, path: string) => void
  collapseAll: () => void
  setSelected: (paths: string[]) => void
  replaceSelectedPath: (from: string, to: string) => void
  toggleSelected: (path: string, checked: boolean) => void
  setSelectedForPaths: (checked: boolean, paths: string[]) => void
  clearSelection: () => void
}

export const useFilesLocalStore = create<FilesLocalState>((set) => ({
  currentPath: "",
  expanded: [],
  selected: [],

  // 换目录时清空选择，避免把上一个目录的条目带过去
  setCurrentPath: (path) => set({ currentPath: path, selected: [] }),

  /** 导航到某个目录，并把它的祖先逐级展开，保证树里能看见当前位置。 */
  enterDirectory: (rootPath, path) =>
    set((state) => {
      const ancestors: string[] = []
      let cursor = path
      while (cursor !== rootPath && isDescendantPath(rootPath, cursor)) {
        ancestors.push(cursor)
        const index = cursor.lastIndexOf("/")
        if (index <= 0) break
        cursor = cursor.slice(0, index)
      }
      return {
        currentPath: path,
        selected: [],
        expanded: Array.from(new Set([...state.expanded, ...ancestors])),
      }
    }),

  toggleExpanded: (path) =>
    set((state) => ({
      expanded: state.expanded.includes(path)
        ? state.expanded.filter((item) => item !== path)
        : [...state.expanded, path],
    })),

  expandAncestors: (rootPath, path) =>
    set((state) => {
      const lineage: string[] = [rootPath]
      let cursor = path
      while (cursor !== rootPath && isDescendantPath(rootPath, cursor)) {
        lineage.push(cursor)
        const index = cursor.lastIndexOf("/")
        if (index <= 0) break
        cursor = cursor.slice(0, index)
      }
      return { expanded: Array.from(new Set([...state.expanded, ...lineage])) }
    }),

  collapseAll: () => set({ expanded: [] }),

  setSelected: (selected) => set({ selected }),

  /**
   * 改名后把选择里的旧路径换成新路径。
   * 不换的话旧路径会永远留在选择里：它不再对应任何条目，
   * 既让「已选 N 项」虚高，也让表头全选清不掉它。
   */
  replaceSelectedPath: (from, to) =>
    set((state) => ({
      selected: state.selected.map((item) => (item === from ? to : item)),
    })),

  toggleSelected: (path, checked) =>
    set((state) => ({
      selected: checked
        ? Array.from(new Set([...state.selected, path]))
        : state.selected.filter((item) => item !== path),
    })),

  /** 表头全选：只增删当前页列出的这些路径，不动其它目录遗留的选择。 */
  setSelectedForPaths: (checked, paths) =>
    set((state) => ({
      selected: checked
        ? Array.from(new Set([...state.selected, ...paths]))
        : state.selected.filter((item) => !paths.includes(item)),
    })),

  clearSelection: () => set({ selected: [] }),
}))
