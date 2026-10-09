import { useMemo, useState } from "react"
import {
  ignoredNames,
  mockSnapshots,
  mockStatus,
  scaleGroupsForManualSnapshot,
  type TrafficSnapshot,
} from "@web/features/traffic/mock-data"

export type TrafficTotals = {
  bytesIn: number
  bytesOut: number
  total: number
  processCount: number
}

/** 快照驱动的流量视图：选中哪份快照，就展示那份快照区间内的进程流量。 */
export const useTraffic = () => {
  const [snapshots, setSnapshots] = useState<TrafficSnapshot[]>(mockSnapshots)
  const [selectedSnapshotId, setSelectedSnapshotId] = useState(
    mockSnapshots[0]?.id ?? ""
  )
  const [ignoreProxy, setIgnoreProxy] = useState(true)
  const [expanded, setExpanded] = useState<string[]>(["node"])
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState(() => Date.now())

  const status = mockStatus

  const selectedSnapshot = useMemo(
    () =>
      snapshots.find((item) => item.id === selectedSnapshotId) ??
      snapshots[0] ??
      null,
    [snapshots, selectedSnapshotId]
  )

  const allGroups = useMemo(() => selectedSnapshot?.groups ?? [], [selectedSnapshot])

  const groups = useMemo(
    () =>
      ignoreProxy
        ? allGroups.filter((item) => !ignoredNames.includes(item.name))
        : allGroups,
    [allGroups, ignoreProxy]
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

  const toggleExpanded = (name: string) => {
    setExpanded((previous) =>
      previous.includes(name)
        ? previous.filter((item) => item !== name)
        : [...previous, name]
    )
  }

  const refresh = () => {
    setRefreshedAt(Date.now())
    setNotice("（演示数据）已刷新实时速率")
  }

  /** 手动保存一份快照：以当前实时累计量为内容，保存后自动选中它。 */
  const saveSnapshot = () => {
    const snapshot = scaleGroupsForManualSnapshot(snapshots.length)
    setSnapshots((previous) => [snapshot, ...previous])
    setSelectedSnapshotId(snapshot.id)
    setNotice(`（演示数据）已保存快照 ${snapshot.rangeText}`)
  }

  const terminate = (label: string, pids: number[]) => {
    setNotice(
      `（演示数据）将结束「${label}」的 ${pids.length} 个进程：${pids.join(", ")}`
    )
  }

  const select = (key: string) => {
    setSelected((previous) => (previous === key ? null : key))
  }

  return {
    snapshots,
    selectedSnapshotId,
    selectSnapshot: setSelectedSnapshotId,
    selectedSnapshot,
    ignoreProxy,
    setIgnoreProxy,
    groups,
    hiddenCount: allGroups.length - groups.length,
    totals,
    status,
    expanded,
    isExpanded: (name: string) => expanded.includes(name),
    toggleExpanded,
    selected,
    select,
    notice,
    refresh,
    saveSnapshot,
    terminate,
    refreshedAt,
  }
}
