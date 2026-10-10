import {
  type ActionResponse,
  type FileBatchResult,
  type FileEntry,
  TASK_KINDS,
} from "@shared/api-contract"
import {
  copyEntries as copyEntriesApi,
  createDirectory as createDirectoryApi,
  createFile as createFileApi,
  deleteEntries as deleteEntriesApi,
  downloadFileUrl,
  moveEntries as moveEntriesApi,
  renameEntry as renameEntryApi,
} from "@shared/client-api"
import { fileDirectoryTarget, fileTaskTarget } from "@shared/task-targets"
import { useQueryClient } from "@tanstack/react-query"
import {
  buildCrumbs,
  dirnameOf,
  type PathCrumb,
  parentPath,
  withName,
} from "@web/features/files/domain"
import { filesKeys, useDirectoryQuery } from "@web/features/files/queries"
import { useFilesLocalStore } from "@web/features/files/store"
import { registerTaskCompletion } from "@web/features/tasks/completion"
import { useTaskAction } from "@web/hooks/use-task-action"
import { useCallback, useEffect } from "react"
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

  const refreshFiles = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: ["files"] })
  }, [queryClient])

  // 新建、改名、保存内容与批量任务共用目标锁：慢路径统一刷新目录缓存。
  useEffect(() => {
    registerTaskCompletion(TASK_KINDS.fileCreate, refreshFiles)
    registerTaskCompletion(TASK_KINDS.fileRename, refreshFiles)
    registerTaskCompletion(TASK_KINDS.fileWriteContent, refreshFiles)
  }, [refreshFiles])

  const createAction = useTaskAction<
    ActionResponse,
    { kind: "mkdir" | "newfile"; parent: string; name: string }
  >({
    kind: TASK_KINDS.fileCreate,
    target: (payload) => fileDirectoryTarget(payload.parent),
    run: (requestId, payload) =>
      payload.kind === "mkdir"
        ? createDirectoryApi(requestId, payload.parent, payload.name)
        : createFileApi(requestId, payload.parent, payload.name),
    onCompleted: (result) => {
      refreshFiles()
      toast.success(result.message)
    },
  })

  const renameAction = useTaskAction<
    ActionResponse,
    { path: string; name: string }
  >({
    kind: TASK_KINDS.fileRename,
    target: (payload) => fileDirectoryTarget(dirnameOf(payload.path)),
    run: (requestId, payload) =>
      renameEntryApi(requestId, payload.path, payload.name),
    onCompleted: (result, payload) => {
      local.replaceSelectedPath(
        payload.path,
        withName(payload.path, payload.name)
      )
      refreshFiles()
      toast.success(result.message)
    },
  })
  /** 三个批量操作的终态统一刷新目录缓存（慢路径走这里）。 */
  useEffect(() => {
    const refresh = (): void => {
      void queryClient.invalidateQueries({ queryKey: ["files"] })
    }
    registerTaskCompletion(TASK_KINDS.fileDelete, refresh)
    registerTaskCompletion(TASK_KINDS.fileCopy, refresh)
    registerTaskCompletion(TASK_KINDS.fileMove, refresh)
  }, [queryClient])

  const deleteAction = useTaskAction<FileBatchResult, string[]>({
    kind: TASK_KINDS.fileDelete,
    target: fileTaskTarget,
    run: (requestId, paths) => deleteEntriesApi(requestId, paths),
    onCompleted: (result, paths) => {
      const failed = result.failed.length
      toast(
        failed === 0
          ? `已删除 ${result.completed.length} 项`
          : `已删除 ${result.completed.length} 项，${failed} 项失败`
      )
      if (failed === 0 && paths.length === result.completed.length) {
        resetSelection()
      }
      void queryClient.invalidateQueries({ queryKey: ["files"] })
    },
  })

  const transferAction = useTaskAction<
    FileBatchResult,
    { mode: "copy" | "move"; paths: string[]; destPath: string }
  >({
    kind: TASK_KINDS.fileCopy,
    target: (payload) => fileTaskTarget([...payload.paths, payload.destPath]),
    run: (requestId, payload) =>
      payload.mode === "copy"
        ? copyEntriesApi(requestId, payload.paths, payload.destPath)
        : moveEntriesApi(requestId, payload.paths, payload.destPath),
    onCompleted: (result, payload) => {
      const failed = result.failed.length
      toast(
        failed === 0
          ? `${payload.mode === "copy" ? "已复制" : "已移动"} ${result.completed.length} 项`
          : `${payload.mode === "copy" ? "已复制" : "已移动"} ${result.completed.length} 项，${failed} 项失败`
      )
      if (payload.mode === "move" && failed === 0) {
        resetSelection()
      }
      void queryClient.invalidateQueries({ queryKey: ["files"] })
    },
  })

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

  const createEntry = (kind: "mkdir" | "newfile", name: string): void => {
    void createAction.run({ kind, parent: resolvedPath, name })
  }

  const renameEntry = (path: string, name: string): void => {
    void renameAction.run({ path, name })
  }

  const deleteEntries = (paths: string[]): void => {
    if (paths.length === 0) return
    void deleteAction.run(paths)
  }

  const transferEntries = (
    mode: "copy" | "move",
    paths: string[],
    destPath: string
  ): void => {
    if (paths.length === 0) return
    void transferAction.run({ mode, paths, destPath })
  }

  const downloadEntry = (entry: FileEntry): void => {
    if (entry.kind !== "file") {
      toast.error("目录暂不支持下载")
      return
    }
    triggerDownload(entry.path)
  }

  const isMutating =
    createAction.busy ||
    renameAction.busy ||
    deleteAction.busy ||
    transferAction.busy

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
