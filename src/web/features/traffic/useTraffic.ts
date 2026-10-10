import {
  type SnapshotMutationResult,
  type SnapshotSaveResult,
  TASK_KINDS,
} from "@shared/api-contract"
import {
  deleteTrafficSnapshots,
  mergeTrafficSnapshots,
  saveTrafficSnapshot,
} from "@shared/client-api"
import { describeError } from "@shared/format"
import { trafficSnapshotTaskTarget } from "@shared/task-targets"
import { useQueryClient } from "@tanstack/react-query"
import { registerTaskCompletion } from "@web/features/tasks/completion"
import {
  useInvalidateTrafficAll,
  useKillProcesses,
  useTrafficGroups,
  useTrafficSnapshots,
  useTrafficStatus,
} from "@web/features/traffic/queries"
import {
  ignoredProxyNames,
  REALTIME_SNAPSHOT_ID,
  useTrafficLocalStore,
} from "@web/features/traffic/store"
import { useTaskAction } from "@web/hooks/use-task-action"
import { useCallback, useEffect, useMemo } from "react"
import { toast } from "sonner"

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
  const notify = (text: string) => toast.success(text)

  const snapshotsQuery = useTrafficSnapshots()
  const statusQuery = useTrafficStatus()
  const groupsQuery = useTrafficGroups(local.selectedIds)

  const invalidateTraffic = useInvalidateTrafficAll()
  const killProcesses = useKillProcesses()

  const snapshots = useMemo(
    () => snapshotsQuery.data ?? [],
    [snapshotsQuery.data]
  )
  const allGroups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data])

  const groups = useMemo(
    () =>
      local.ignoreProxy
        ? allGroups.filter((item) => !ignoredProxyNames.includes(item.name))
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

  /** 手动刷新：让缓存里的数据重新拉一次，取到后端最新一轮采样。 */
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

  /**
   * 快照写操作完成后统一重新读取列表与明细。
   * 慢路径（后台任务）由任务完成回调触发，快速路径由 onCompleted 触发。
   */
  const refreshSnapshots = useCallback(() => {
    invalidateTraffic()
  }, [invalidateTraffic])

  useEffect(() => {
    registerTaskCompletion(TASK_KINDS.trafficSnapshotSave, refreshSnapshots)
    registerTaskCompletion(TASK_KINDS.trafficSnapshotMerge, refreshSnapshots)
    registerTaskCompletion(TASK_KINDS.trafficSnapshotDelete, refreshSnapshots)
  }, [refreshSnapshots])

  const saveAction = useTaskAction<SnapshotSaveResult, undefined>({
    kind: TASK_KINDS.trafficSnapshotSave,
    target: trafficSnapshotTaskTarget(),
    run: (requestId) => saveTrafficSnapshot(requestId),
    onCompleted: (result) => {
      local.setSelectedIds([result.snapshotId])
      notify(`已保存快照 ${result.rangeText}`)
      refreshSnapshots()
    },
  })

  const mergeAction = useTaskAction<SnapshotMutationResult, string[]>({
    kind: TASK_KINDS.trafficSnapshotMerge,
    target: trafficSnapshotTaskTarget(),
    run: (requestId, ids) => mergeTrafficSnapshots(requestId, ids),
    onCompleted: () => {
      local.setSelectedIds(local.selectedIds.slice(0, 1))
      notify(`已把 ${local.selectedIds.length} 份快照合并成一份`)
      refreshSnapshots()
    },
  })

  const deleteAction = useTaskAction<SnapshotMutationResult, string[]>({
    kind: TASK_KINDS.trafficSnapshotDelete,
    target: trafficSnapshotTaskTarget(),
    run: (requestId, ids) => deleteTrafficSnapshots(requestId, ids),
    onCompleted: () => {
      local.setSelectedIds([REALTIME_SNAPSHOT_ID])
      local.setSelectionMode(false)
      notify("已删除快照，后继快照已重新计算为合并区间")
      refreshSnapshots()
    },
  })

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

  /** 只删除一份时先把它选中，动作编排统一按当前选择执行。 */
  const handleRemoveSnapshot = (id: string) => {
    local.setSelectedIds([id])
    void deleteAction.run([id])
  }

  const handleRemoveSelected = () => {
    void deleteAction.run(
      local.selectedIds.filter((id) => id !== REALTIME_SNAPSHOT_ID)
    )
  }

  const handleMergeSelected = () => {
    void mergeAction.run(local.selectedIds)
  }

  const terminate = (label: string, pids: number[]) => {
    killProcesses.mutate(
      { pids },
      {
        onSuccess: (data) => {
          const failed = data.results.filter((item) => !item.succeeded)
          notify(
            failed.length === 0
              ? `已结束「${label}」的 ${pids.length} 个进程`
              : `结束「${label}」失败：${failed.map((item) => `PID ${item.pid} ${item.message}`).join("；")}`
          )
        },
        onError: (error) =>
          toast.error(`结束进程失败：${describeError(error)}`),
      }
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
    saveSnapshot: {
      run: saveAction.run,
      busy: saveAction.busy,
      task: saveAction.task,
    },
    removeSnapshot: handleRemoveSnapshot,
    removeSelected: handleRemoveSelected,
    mergeSelected: handleMergeSelected,
    /** 三种快照写操作共用一把域级锁，因此共用一个进行中状态。 */
    snapshotWriteBusy: saveAction.busy || mergeAction.busy || deleteAction.busy,
    snapshotTask: saveAction.task ?? mergeAction.task ?? deleteAction.task,
    terminate,

    // 页面级提示
    notify,
    refresh,
  }
}
