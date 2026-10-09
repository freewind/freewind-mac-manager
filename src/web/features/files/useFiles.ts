import { useQueryClient } from "@tanstack/react-query"
import {
  buildCrumbs,
  parentPath,
  type PathCrumb,
} from "@web/features/files/domain"
import { filesKeys, useDirectoryQuery } from "@web/features/files/queries"
import { useFilesLocalStore } from "@web/features/files/store"

/**
 * 文件管理页的数据入口。
 *
 * - 远程状态：TanStack Query（每个目录一份 DirectoryResponse，树与表共用）
 * - 本地共享状态：Zustand（当前目录、树的展开、表格的勾选）
 * - 页面级瞬时状态：React state（表格排序、弹窗开关，留在各自组件里）
 */
export const useFiles = () => {
  const queryClient = useQueryClient()
  const local = useFilesLocalStore()

  // 根目录：空串请求由服务端解析成真实根路径，树根与面包屑都以它为准
  const rootQuery = useDirectoryQuery("")
  const rootPath = rootQuery.data?.path ?? ""

  // 当前目录：根定位完成后就用真实根路径，与目录树共用同一份缓存
  const targetPath = local.currentPath === "" ? rootPath : local.currentPath
  const currentQuery = useDirectoryQuery(targetPath)

  const entries = currentQuery.data?.entries ?? []
  const resolvedPath = currentQuery.data?.path ?? targetPath
  const crumbs: PathCrumb[] = resolvedPath
    ? buildCrumbs(rootPath, resolvedPath)
    : []

  const isSelected = (path: string): boolean => local.selected.includes(path)

  const selectOnly = (path: string): void => local.setSelected([path])

  /** 让当前目录与已展开的树节点重新拉一次。 */
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: filesKeys.all })
  }

  const enterDirectory = (path: string): void => {
    local.enterDirectory(rootPath, path)
  }

  const goToParent = (): void => {
    if (!rootPath) return
    const parent = parentPath(rootPath, resolvedPath)
    if (parent === resolvedPath) return
    local.enterDirectory(rootPath, parent)
  }

  const canGoUp = rootPath.length > 0 && resolvedPath !== rootPath

  return {
    // 数据
    rootPath,
    currentPath: resolvedPath,
    entries,
    crumbs,
    isLoading: currentQuery.isLoading || rootQuery.isLoading,
    isFetching: currentQuery.isFetching,
    error: currentQuery.error ?? rootQuery.error,

    // 本地共享状态
    isExpanded: (path: string) => local.expanded.includes(path),
    toggleExpanded: local.toggleExpanded,
    collapseAll: local.collapseAll,
    selected: local.selected,
    isSelected,
    selectOnly,
    toggleSelected: local.toggleSelected,
    setSelectedForPaths: local.setSelectedForPaths,
    clearSelection: local.clearSelection,

    // 动作
    enterDirectory,
    goToParent,
    canGoUp,
    refresh,
  }
}

export type FilesModel = ReturnType<typeof useFiles>
