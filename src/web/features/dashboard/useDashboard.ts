import { useQueryClient } from "@tanstack/react-query"
import { useMemo } from "react"
import type { MemoryInfo, ProcessInfo } from "@web/features/dashboard/mock-data"
import {
  dashboardKeys,
  useListeningPorts,
  useMachineSnapshot,
  useTopProcesses,
} from "@web/features/dashboard/queries"
import {
  useDashboardStore,
  type ProcessSortKey,
} from "@web/features/dashboard/store"

export type MemoryPressure = {
  label: string
  level: "ok" | "warn" | "high"
}

/**
 * 概览页的数据入口。
 *
 * - 远程状态：TanStack Query（机器快照、进程、端口）
 * - 本地共享状态：Zustand（刷新开关、进程表排序）
 * - 派生展示值：这里的 useMemo（排序结果、内存压力）
 */
export const useDashboard = () => {
  const local = useDashboardStore()
  const queryClient = useQueryClient()

  const snapshotQuery = useMachineSnapshot()
  const processesQuery = useTopProcesses()
  const portsQuery = useListeningPorts()

  const processes = useMemo(
    () =>
      sortProcesses(
        processesQuery.data ?? [],
        local.processSortKey,
        local.processDescending
      ),
    [processesQuery.data, local.processSortKey, local.processDescending]
  )

  const snapshot = snapshotQuery.data ?? null

  return {
    snapshot,
    loading: snapshotQuery.isPending,
    processes,
    ports: portsQuery.data ?? [],
    pressure: snapshot ? describeMemoryPressure(snapshot.memory) : null,
    processSortKey: local.processSortKey,
    processDescending: local.processDescending,
    setProcessSort: local.setProcessSort,
    paused: local.paused,
    togglePaused: local.togglePaused,
    refresh: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all })
    },
  }
}

const sortProcesses = (
  processes: ProcessInfo[],
  key: ProcessSortKey,
  descending: boolean
): ProcessInfo[] => {
  const factor = descending ? -1 : 1
  return [...processes].sort((left, right) => {
    if (key === "name") {
      return left.name.localeCompare(right.name) * factor
    }
    const leftValue = key === "cpu" ? left.cpu : left.memory
    const rightValue = key === "cpu" ? right.cpu : right.memory
    return (leftValue - rightValue) * factor
  })
}

const describeMemoryPressure = (memory: MemoryInfo): MemoryPressure => {
  const usage = (memory.used + memory.wired + memory.compressed) / memory.total
  const swap = memory.swapUsed / memory.swapTotal
  if (usage > 0.85 || swap > 0.85) return { label: "紧张", level: "high" }
  if (usage > 0.7 || swap > 0.6) return { label: "偏高", level: "warn" }
  return { label: "正常", level: "ok" }
}
