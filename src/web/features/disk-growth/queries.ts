import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { GrowthEntry, ScanStatus, ScansResponse, TreeNode } from "@shared/api-contract/types"
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
import {
  appendMockSnapshot,
  deleteMockSnapshots,
  mockEntries,
  mockScanPhases,
  mockSearch,
  mockSnapshots,
  mockStatus,
  mockTree,
  truncateTree,
} from "@web/features/disk-growth/mock-data"
import { useDiskGrowthStore } from "@web/features/disk-growth/store"

const KEYS = {
  snapshots: ["disk-growth", "snapshots"] as const,
  status: ["disk-growth", "scan-status"] as const,
  entries: (source: string, scanId: number, baseline: number | null, path: string) =>
    ["disk-growth", "entries", source, scanId, baseline, path] as const,
  search: (source: string, scanId: number, baseline: number | null, keyword: string) =>
    ["disk-growth", "search", source, scanId, baseline, keyword] as const,
  tree: (source: string, scanId: number, baseline: number | null, path: string, depth: number) =>
    ["disk-growth", "tree", source, scanId, baseline, path, depth] as const,
}

export const useSnapshots = () => {
  const setDataSource = useDiskGrowthStore((state) => state.setDataSource)
  const dataSource = useDiskGrowthStore((state) => state.dataSource)

  const query = useQuery({
    queryKey: KEYS.snapshots,
    queryFn: async (): Promise<ScansResponse> => {
      try {
        const data = await fetchScans()
        if (data.snapshots.length > 0) {
          setDataSource("server")
          return data
        }
      } catch {
        // 后端不可用时退回本地演示数据，保证界面可用。
      }
      setDataSource("demo")
      return { snapshots: mockSnapshots() }
    },
  })

  const snapshots =
    dataSource === "demo" ? mockSnapshots() : (query.data?.snapshots ?? [])
  return { snapshots, isLoading: query.isLoading }
}

/** 快照区间：端点 → 列表下标区间 → 连续 id 列表。 */
export const useSelectionRange = (snapshots: ScansResponse["snapshots"]) => {
  const selection = useDiskGrowthStore((state) => state.selection)
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

export const useScanStatus = (): ScanStatus => {
  const dataSource = useDiskGrowthStore((state) => state.dataSource)
  const mockPhase = useDiskGrowthStore((state) => state.mockPhase)
  const query = useQuery({
    queryKey: KEYS.status,
    queryFn: fetchScanStatus,
    enabled: dataSource === "server",
    refetchInterval: 2000,
  })

  if (dataSource === "demo") {
    const latest = mockSnapshots()[0]
    return mockPhase
      ? { ...mockStatus(latest), running: true, phase: mockPhase }
      : mockStatus(latest)
  }

  return (
    query.data ?? {
      running: false,
      phase: "尚未扫描",
      startedAt: null,
      finishedAt: null,
      scannedEntries: 0,
      lastError: null,
    }
  )
}

export const useChildren = (options: {
  scanId: number | null
  baselineScanId: number | null
  path: string
  spanDays: number
}) => {
  const { scanId, baselineScanId, path, spanDays } = options
  const dataSource = useDiskGrowthStore((state) => state.dataSource)
  const query = useQuery({
    queryKey: KEYS.entries(dataSource, scanId ?? 0, baselineScanId, path),
    enabled: scanId != null,
    queryFn: async (): Promise<GrowthEntry[]> => {
      if (dataSource === "demo") return mockEntries(path, spanDays).entries
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
  spanDays: number
}) => {
  const { scanId, baselineScanId, spanDays } = options
  const dataSource = useDiskGrowthStore((state) => state.dataSource)
  const trimmed = options.keyword.trim()
  const query = useQuery({
    queryKey: KEYS.search(dataSource, scanId ?? 0, baselineScanId, trimmed),
    enabled: scanId != null && trimmed.length > 0,
    queryFn: async (): Promise<GrowthEntry[]> => {
      if (dataSource === "demo") return mockSearch(trimmed, spanDays)
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
  spanDays: number
}) => {
  const { scanId, baselineScanId, path, depth } = options
  const dataSource = useDiskGrowthStore((state) => state.dataSource)
  const query = useQuery({
    queryKey: KEYS.tree(dataSource, scanId ?? 0, baselineScanId, path, depth),
    enabled: scanId != null,
    queryFn: async (): Promise<TreeNode | null> => {
      if (dataSource === "demo") {
        const tree = mockTree(path)
        return tree ? truncateTree(tree, depth) : null
      }
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

/** 触发一次扫描；演示数据源下本地模拟整段过程并追加一份快照。 */
export const useStartScan = () => {
  const client = useQueryClient()
  const dataSource = useDiskGrowthStore((state) => state.dataSource)
  const setMockPhase = useDiskGrowthStore((state) => state.setMockPhase)
  const resetForNewSnapshot = useDiskGrowthStore(
    (state) => state.resetForNewSnapshot
  )

  return useMutation({
    mutationFn: async (): Promise<string> => {
      if (dataSource === "server") {
        const result = await triggerScan()
        client.invalidateQueries({ queryKey: KEYS.status })
        return result.message
      }
      for (const phase of mockScanPhases()) {
        setMockPhase(phase)
        await new Promise((resolve) => setTimeout(resolve, 700))
      }
      setMockPhase(null)
      appendMockSnapshot()
      resetForNewSnapshot()
      return "扫描完成"
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: KEYS.snapshots })
    },
  })
}

export const useDeleteScans = () => {
  const client = useQueryClient()
  const dataSource = useDiskGrowthStore((state) => state.dataSource)
  const resetForNewSnapshot = useDiskGrowthStore(
    (state) => state.resetForNewSnapshot
  )
  return useMutation({
    mutationFn: async (ids: number[]): Promise<string> => {
      if (dataSource === "demo") {
        deleteMockSnapshots(ids)
        resetForNewSnapshot()
        return `已删除 ${ids.length} 份快照，相邻快照的差值已自动跨过被删区间`
      }
      const result = await deleteScansApi(ids)
      resetForNewSnapshot()
      return result.message
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: KEYS.snapshots })
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
      client.invalidateQueries({ queryKey: ["disk-growth"] })
    },
  })
}
