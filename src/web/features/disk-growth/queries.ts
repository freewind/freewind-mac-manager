import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { GrowthEntry, ScanStatus, TreeNode } from "@shared/api-contract"
import {
  deleteScans as deleteScansApi,
  fetchEntries,
  fetchScanStatus,
  fetchScans,
  fetchTree,
  revealEntry as revealEntryApi,
  trashEntry as trashEntryApi,
  triggerScan,
} from "@shared/client-api"
import { useDiskGrowthLocalStore } from "@web/features/disk-growth/store"

export const diskGrowthKeys = {
  all: ["disk-growth"] as const,
  snapshots: ["disk-growth", "snapshots"] as const,
  status: ["disk-growth", "scan-status"] as const,
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

const IDLE_STATUS: ScanStatus = {
  running: false,
  phase: "尚未扫描",
  startedAt: null,
  finishedAt: null,
  scannedEntries: 0,
  lastError: null,
}

export const useScanStatus = (): ScanStatus => {
  const query = useQuery({
    queryKey: diskGrowthKeys.status,
    queryFn: fetchScanStatus,
    refetchInterval: 2000,
  })
  return query.data ?? IDLE_STATUS
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

export const useStartScan = () => {
  const client = useQueryClient()
  const resetForNewSnapshot = useDiskGrowthLocalStore(
    (state) => state.resetForNewSnapshot
  )
  return useMutation({
    mutationFn: async (): Promise<string> => {
      const result = await triggerScan()
      client.invalidateQueries({ queryKey: diskGrowthKeys.status })
      return result.message
    },
    onSuccess: () => {
      resetForNewSnapshot()
      client.invalidateQueries({ queryKey: diskGrowthKeys.snapshots })
    },
  })
}

export const useDeleteScans = () => {
  const client = useQueryClient()
  const resetForNewSnapshot = useDiskGrowthLocalStore(
    (state) => state.resetForNewSnapshot
  )
  return useMutation({
    mutationFn: async (ids: number[]): Promise<string> => {
      const result = await deleteScansApi(ids)
      return result.message
    },
    onSuccess: () => {
      resetForNewSnapshot()
      client.invalidateQueries({ queryKey: diskGrowthKeys.snapshots })
    },
  })
}

export const useRevealEntry = () =>
  useMutation({ mutationFn: (path: string) => revealEntryApi(path) })

export const useTrashEntry = () => {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (path: string) => trashEntryApi(path),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: diskGrowthKeys.all })
    },
  })
}
