import type { FileEntry } from "@shared/api-contract"
import { downloadFileUrl } from "@shared/client-api"
import { describeError } from "@shared/format"
import { useQueryClient } from "@tanstack/react-query"
import {
  buildCrumbs,
  type PathCrumb,
  parentPath,
  withName,
} from "@web/features/files/domain"
import {
  filesKeys,
  useCreateEntryMutation,
  useDeleteEntriesMutation,
  useDirectoryQuery,
  useRenameEntryMutation,
  useTransferEntriesMutation,
} from "@web/features/files/queries"
import { useFilesLocalStore } from "@web/features/files/store"
import { toast } from "sonner"

/** 用临时 <a> 触发浏览器原生下载；window.open 在非直接点击时会被拦截。 */
const triggerDownload = (path: string): void => {
  const link = document.createElement("a")
  link.href = downloadFileUrl(path)
  link.download = ""
  document.body.append(link)
  link.click()
  link.remove()
}

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

  const createEntryMutation = useCreateEntryMutation()
  const renameEntryMutation = useRenameEntryMutation()
  const deleteEntriesMutation = useDeleteEntriesMutation()
  const transferEntriesMutation = useTransferEntriesMutation()

  const entries = currentQuery.data?.entries ?? []
  const resolvedPath = currentQuery.data?.path ?? targetPath
  const crumbs: PathCrumb[] = resolvedPath
    ? buildCrumbs(rootPath, resolvedPath)
    : []
  const selectedEntries = entries.filter((entry) =>
    local.selected.includes(entry.path)
  )

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

  /**
   * 写操作后清空选择：删除与移动会让被选条目离开当前目录，
   * 选择留着就会出现指向不存在条目的残留。
   */
  const resetSelection = (): void => {
    local.setSelected([])
  }

  const createEntry = async (
    kind: "mkdir" | "newfile",
    name: string
  ): Promise<void> => {
    try {
      await createEntryMutation.mutateAsync({
        kind,
        parent: resolvedPath,
        name,
      })
      toast.success(
        kind === "mkdir" ? `已新建文件夹：${name}` : `已新建文件：${name}`
      )
    } catch (error) {
      toast.error(describeError(error))
    }
  }

  const renameEntry = async (path: string, name: string): Promise<void> => {
    try {
      await renameEntryMutation.mutateAsync({ path, name })
      local.replaceSelectedPath(path, withName(path, name))
      toast.success(`已重命名为：${name}`)
    } catch (error) {
      toast.error(describeError(error))
    }
  }

  const deleteEntries = async (paths: string[]): Promise<void> => {
    if (paths.length === 0) return
    try {
      await deleteEntriesMutation.mutateAsync(paths)
      resetSelection()
      toast.success(`已删除 ${paths.length} 项`)
    } catch (error) {
      toast.error(describeError(error))
    }
  }

  const transferEntries = async (
    mode: "copy" | "move",
    paths: string[],
    destPath: string
  ): Promise<void> => {
    if (paths.length === 0) return
    try {
      await transferEntriesMutation.mutateAsync({ mode, paths, destPath })
      toast.success(
        mode === "copy"
          ? `已复制 ${paths.length} 项`
          : `已移动 ${paths.length} 项`
      )
      if (mode === "move") {
        resetSelection()
      }
    } catch (error) {
      toast.error(describeError(error))
    }
  }

  const downloadEntry = (entry: FileEntry): void => {
    if (entry.kind !== "file") {
      toast.error("目录暂不支持下载")
      return
    }
    triggerDownload(entry.path)
  }

  const isMutating =
    createEntryMutation.isPending ||
    renameEntryMutation.isPending ||
    deleteEntriesMutation.isPending ||
    transferEntriesMutation.isPending

  return {
    // 数据
    rootPath,
    currentPath: resolvedPath,
    entries,
    crumbs,
    selectedEntries,
    isLoading: currentQuery.isLoading || rootQuery.isLoading,
    isFetching: currentQuery.isFetching,
    isMutating,
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

    // 导航
    enterDirectory,
    goToParent,
    canGoUp,
    refresh,

    // 写操作
    createEntry,
    renameEntry,
    deleteEntries,
    transferEntries,
    downloadEntry,
  }
}

export type FilesModel = ReturnType<typeof useFiles>
