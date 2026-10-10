import {
  type ActionResponse,
  type DiskSnapshotDeleteResult,
  type GrowthEntry,
  TASK_KINDS,
  type TreeNode,
} from "@shared/api-contract"
import {
  deleteScans as deleteScansApi,
  fetchEntries,
  fetchScans,
  fetchTree,
  revealEntry as revealEntryApi,
  trashEntry as trashEntryApi,
} from "@shared/client-api"
import { fileTaskTarget } from "@shared/task-targets"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useDiskGrowthLocalStore } from "@web/features/disk-growth/store"
import { registerTaskCompletion } from "@web/features/tasks/completion"
import { useTaskAction } from "@web/hooks/use-task-action"
import { useCallback, useEffect } from "react"
import { toast } from "sonner"

export const diskGrowthKeys = {
  all: ["disk-growth"] as const,
  snapshots: ["disk-growth", "snapshots"] as const,
  entries: (scanId: number, baseline: number | null, path: string) =>
    ["disk-growth", "entries", scanId, baseline, path] as const,
  search: (scanId: number, baseline: number | null, keyword: string) =>
    ["disk-growth", "search", scanId, baseline, keyword] as const,
  tree: (
    scanId: number,
    baseline: number | null,
    path: string,
    depth: number
  ) => ["disk-growth", "tree", scanId, baseline, path, depth] as const,
}

export const useSnapshots = () => {
  const query = useQuery({
    queryKey: diskGrowthKeys.snapshots,
    queryFn: async () => (await fetchScans()).snapshots,
  })
  return { snapshots: query.data ?? [], isLoading: query.isLoading }
}

/** 快照区间：端点 → 列表下标区间 → 连续 id 列表。 */
export const useSelectionRange = (
  snapshots: ReturnType<typeof useSnapshots>["snapshots"]
) => {
  const selection = useDiskGrowthLocalStore((state) => state.selection)
  const fallback = {
    ids: snapshots.length > 0 ? [snapshots[0].id] : ([] as number[]),
    scanId: snapshots[0]?.id ?? null,
    baselineScanId: snapshots[1]?.id ?? null,
  }
  if (snapshots.length === 0 || selection.length === 0) return fallback
  const indexes = selection
    .map((id) => snapshots.findIndex((snapshot) => snapshot.id === id))
    .filter((index) => index >= 0)
  if (indexes.length === 0) return fallback
  const from = Math.min(...indexes)
  const to = Math.max(...indexes)
  const ids = snapshots.slice(from, to + 1).map((snapshot) => snapshot.id)
  return { ids, scanId: ids[0], baselineScanId: snapshots[to + 1]?.id ?? null }
}

export const useChildren = (options: {
  scanId: number | null
  baselineScanId: number | null
  path: string
}) => {
  const { scanId, baselineScanId, path } = options
  const query = useQuery({
    queryKey: diskGrowthKeys.entries(scanId ?? 0, baselineScanId, path),
    enabled: scanId != null,
    queryFn: async (): Promise<GrowthEntry[]> => {
      const data = await fetchEntries({
        scanId: scanId as number,
        baselineScanId: baselineScanId ?? undefined,
        path,
      })
      return data.entries
    },
  })
  return { entries: query.data ?? [], isLoading: query.isLoading }
}

export const useSearch = (options: {
  scanId: number | null
  baselineScanId: number | null
  keyword: string
}) => {
  const { scanId, baselineScanId } = options
  const trimmed = options.keyword.trim()
  const query = useQuery({
    queryKey: diskGrowthKeys.search(scanId ?? 0, baselineScanId, trimmed),
    enabled: scanId != null && trimmed.length > 0,
    queryFn: async (): Promise<GrowthEntry[]> => {
      const data = await fetchEntries({
        scanId: scanId as number,
        baselineScanId: baselineScanId ?? undefined,
        path: "",
        keyword: trimmed,
      })
      return data.entries
    },
  })
  return {
    results: trimmed.length > 0 ? (query.data ?? []) : [],
    isLoading: query.isLoading,
  }
}

/** 分布图用的子树：一次取回前若干层。 */
export const useSubtree = (options: {
  scanId: number | null
  baselineScanId: number | null
  path: string
  depth: number
}) => {
  const { scanId, baselineScanId, path, depth } = options
  const query = useQuery({
    queryKey: diskGrowthKeys.tree(scanId ?? 0, baselineScanId, path, depth),
    enabled: scanId != null,
    queryFn: async (): Promise<TreeNode | null> => {
      const data = await fetchTree({
        scanId: scanId as number,
        baselineScanId: baselineScanId ?? undefined,
        path,
        depth,
      })
      return data.root
    },
  })
  return { root: query.data ?? null, isLoading: query.isLoading }
}

/**
 * 删除快照：受理时不动缓存，只有真正完成才刷新列表并重置选择。
 * 慢路径的刷新由按种类登记的完成处理负责。
 */
export const useDeleteScans = () => {
  const client = useQueryClient()
  const resetForNewSnapshot = useDiskGrowthLocalStore(
    (state) => state.resetForNewSnapshot
  )

  // 慢路径（后台任务）完成时刷新列表；刷新逻辑独立成回调，effect 里只做登记。
  const refreshSnapshots = useCallback(() => {
    resetForNewSnapshot()
    void client.invalidateQueries({ queryKey: diskGrowthKeys.snapshots })
  }, [client, resetForNewSnapshot])

  useEffect(() => {
    registerTaskCompletion(TASK_KINDS.diskSnapshotDelete, refreshSnapshots)
  }, [refreshSnapshots])

  return useTaskAction<DiskSnapshotDeleteResult, number[]>({
    kind: TASK_KINDS.diskSnapshotDelete,
    target: "disk-growth:snapshots",
    run: (requestId, ids) => deleteScansApi(requestId, ids),
    onCompleted: (result) => {
      toast.success(
        result.removed === 0
          ? "指定的快照已不存在"
          : `已删除 ${result.removed} 份快照，相邻快照的差值已自动跨过被删区间`
      )
      resetForNewSnapshot()
      void client.invalidateQueries({ queryKey: diskGrowthKeys.snapshots })
    },
  })
}

/**
 * 访达定位与移到废纸篓：受理时不动缓存，只有真正完成才刷新；
 * 废纸篓会改变目录结构，因此完成后整域缓存失效。
 */
export const useRevealEntry = () =>
  useTaskAction<ActionResponse, string>({
    kind: TASK_KINDS.diskEntryReveal,
    target: (path) => fileTaskTarget([path]),
    run: (requestId, path) => revealEntryApi(requestId, path),
    onCompleted: (result) => {
      toast.success(result.message)
    },
  })

export const useTrashEntry = () => {
  const client = useQueryClient()

  const refresh = useCallback((): void => {
    void client.invalidateQueries({ queryKey: diskGrowthKeys.all })
  }, [client])

  useEffect(() => {
    registerTaskCompletion(TASK_KINDS.diskEntryTrash, refresh)
  }, [refresh])

  return useTaskAction<ActionResponse, string>({
    kind: TASK_KINDS.diskEntryTrash,
    target: (path) => fileTaskTarget([path]),
    run: (requestId, path) => trashEntryApi(requestId, path),
    onCompleted: (result) => {
      refresh()
      toast.success(result.message)
    },
  })
}
