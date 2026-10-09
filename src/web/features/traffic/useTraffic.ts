import { useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { ignoredNames } from "@web/features/traffic/mock-data"
import {
  useMergeSnapshots,
  useRemoveSnapshot,
  useRemoveSnapshots,
  useSaveSnapshot,
  useTrafficGroups,
  useTrafficSnapshots,
  useTrafficStatus,
} from "@web/features/traffic/queries"
import {
  REALTIME_SNAPSHOT_ID,
  useTrafficLocalStore,
} from "@web/features/traffic/store"

export { REALTIME_SNAPSHOT_ID }

export type TrafficTotals = {
  bytesIn: number
  bytesOut: number
  total: number
  processCount: number
}

/**
 * 流量监控的数据入口。
 *
 * - 远程状态：TanStack Query（快照、实时速率、进程明细）
 * - 本地共享状态：Zustand（选中、展开、忽略代理、多选模式）
 * - 页面级瞬时状态：React state（这里的提示、页面里的排序与确认弹窗）
 */
export const useTraffic = () => {
  const queryClient = useQueryClient()
  const local = useTrafficLocalStore()
  const [notice, setNotice] = useState<string | null>(null)

  const snapshotsQuery = useTrafficSnapshots()
  const statusQuery = useTrafficStatus()
  const groupsQuery = useTrafficGroups(local.selectedIds)

  const saveSnapshot = useSaveSnapshot()
  const removeSnapshot = useRemoveSnapshot()
  const removeSnapshots = useRemoveSnapshots()
  const mergeSnapshots = useMergeSnapshots()

  const snapshots = useMemo(
    () => snapshotsQuery.data ?? [],
    [snapshotsQuery.data]
  )
  const allGroups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data])

  const groups = useMemo(
    () =>
      local.ignoreProxy
        ? allGroups.filter((item) => !ignoredNames.includes(item.name))
        : allGroups,
    [allGroups, local.ignoreProxy]
  )

  const totals = useMemo<TrafficTotals>(
    () =>
      groups.reduce<TrafficTotals>(
        (accumulator, item) => ({
          bytesIn: accumulator.bytesIn + item.bytesIn,
          bytesOut: accumulator.bytesOut + item.bytesOut,
          total: accumulator.total + item.bytesIn + item.bytesOut,
          processCount: accumulator.processCount + 1,
        }),
        { bytesIn: 0, bytesOut: 0, total: 0, processCount: 0 }
      ),
    [groups]
  )

  const selectedSnapshots = useMemo(
    () => snapshots.filter((item) => local.selectedIds.includes(item.id)),
    [snapshots, local.selectedIds]
  )

  const isRealtime = local.selectedIds.includes(REALTIME_SNAPSHOT_ID)

  const notify = (text: string) => setNotice(text)

  /** 手动刷新：让缓存里的数据重新拉一次（后端就绪后即重新采样）。 */
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["traffic"] })
    notify("已刷新")
  }

  /** 选择快照；按住 Shift 时把上一次选中的那份与这次之间全部选中。 */
  const selectSnapshot = (id: string, additive = false) => {
    const previous = local.selectedIds
    const canExtend =
      additive &&
      id !== REALTIME_SNAPSHOT_ID &&
      previous.length > 0 &&
      !previous.includes(REALTIME_SNAPSHOT_ID)

    if (!canExtend) {
      local.setSelectedIds([id])
      return
    }

    const order = snapshots.map((item) => item.id)
    const anchor = previous[previous.length - 1]
    const from = order.indexOf(anchor)
    const to = order.indexOf(id)
    if (from < 0 || to < 0) {
      local.setSelectedIds([id])
      return
    }

    const [start, end] = from <= to ? [from, to] : [to, from]
    local.setSelectedIds(order.slice(start, end + 1))
  }

  const startSelection = (id: string) => {
    local.setSelectionMode(true)
    local.setSelectedIds([id])
    notify("多选模式：勾选另一份，中间的快照会一起选中")
  }

  const exitSelection = () => local.setSelectionMode(false)

  /** 多选模式下勾选：连同锚点之间的一段一起选中。 */
  const toggleSelection = (id: string) => {
    if (local.selectedIds.includes(id)) {
      const next = local.selectedIds.filter((item) => item !== id)
      local.setSelectedIds(next.length > 0 ? next : [REALTIME_SNAPSHOT_ID])
      return
    }

    const order = snapshots.map((item) => item.id)
    const anchor =
      local.selectedIds.find((item) => item !== REALTIME_SNAPSHOT_ID) ?? id
    const from = order.indexOf(anchor)
    const to = order.indexOf(id)
    if (from < 0 || to < 0) {
      local.setSelectedIds([id])
      return
    }

    const [start, end] = from <= to ? [from, to] : [to, from]
    local.setSelectedIds(order.slice(start, end + 1))
  }

  const selectedSnapshotIds = local.selectedIds.filter(
    (id) => id !== REALTIME_SNAPSHOT_ID
  )

  const handleSaveSnapshot = () => {
    saveSnapshot.mutate(undefined, {
      onSuccess: (snapshot) => {
        local.setSelectedIds([snapshot.id])
        notify(`（演示数据）已保存快照 ${snapshot.rangeText}`)
      },
    })
  }

  const handleRemoveSnapshot = (id: string) => {
    removeSnapshot.mutate(id, {
      onSuccess: () => {
        const next = local.selectedIds.filter((item) => item !== id)
        local.setSelectedIds(next.length > 0 ? next : [REALTIME_SNAPSHOT_ID])
        notify("（演示数据）已删除快照，其后一份已重新计算为合并区间")
      },
    })
  }

  const handleRemoveSelected = () => {
    removeSnapshots.mutate(selectedSnapshotIds, {
      onSuccess: () => {
        local.setSelectedIds([REALTIME_SNAPSHOT_ID])
        local.setSelectionMode(false)
        notify(
          `（演示数据）已删除 ${selectedSnapshotIds.length} 份快照，受影响的后继快照已重新计算`
        )
      },
    })
  }

  const handleMergeSelected = () => {
    mergeSnapshots.mutate(selectedSnapshotIds, {
      onSuccess: () => {
        local.setSelectedIds([selectedSnapshotIds[0]])
        notify(
          `（演示数据）已把 ${selectedSnapshotIds.length} 份快照合并成一份`
        )
      },
    })
  }

  const terminate = (label: string, pids: number[]) => {
    setNotice(
      `（演示数据）将结束「${label}」的 ${pids.length} 个进程：${pids.join(", ")}`
    )
  }

  return {
    // 数据
    snapshots,
    status: statusQuery.data,
    groups,
    totals,
    hiddenCount: allGroups.length - groups.length,
    isLoading: snapshotsQuery.isLoading || groupsQuery.isLoading,
    error: snapshotsQuery.error ?? groupsQuery.error,

    // 本地共享状态
    selectedIds: local.selectedIds,
    isSelected: (id: string) => local.selectedIds.includes(id),
    selectedSnapshotCount: selectedSnapshots.length,
    selectedSnapshots,
    isRealtime,
    selectionMode: local.selectionMode,
    ignoreProxy: local.ignoreProxy,
    setIgnoreProxy: local.setIgnoreProxy,
    expandedNames: local.expandedNames,
    isExpanded: (name: string) => local.expandedNames.includes(name),
    toggleExpanded: local.toggleExpanded,
    selectedRowKey: local.selectedRowKey,
    selectRow: local.selectRow,

    // 动作
    selectSnapshot,
    startSelection,
    exitSelection,
    toggleSelection,
    saveSnapshot: handleSaveSnapshot,
    removeSnapshot: handleRemoveSnapshot,
    removeSelected: handleRemoveSelected,
    mergeSelected: handleMergeSelected,
    terminate,

    // 页面级提示
    notice,
    notify,
    refresh,
  }
}
