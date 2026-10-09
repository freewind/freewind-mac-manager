import { useMemo, useState } from "react"
import {
  ignoredNames,
  mockGroups,
  mockStatus,
  type TrafficGroup,
} from "@web/features/traffic/mock-data"

export type RangeKind = "today" | "last7Days" | "custom"

const RANGE_LABELS: Record<RangeKind, string> = {
  today: "今天",
  last7Days: "近 7 天",
  custom: "自定义",
}

export type TrafficTotals = {
  bytesIn: number
  bytesOut: number
  total: number
  processCount: number
}

export const useTraffic = () => {
  const [rangeKind, setRangeKind] = useState<RangeKind>("today")
  const [ignoreProxy, setIgnoreProxy] = useState(true)
  const [expanded, setExpanded] = useState<string[]>(["node"])
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState(() => Date.now())

  const groups: TrafficGroup[] = mockGroups
  const status = mockStatus

  const visibleGroups = useMemo(
    () =>
      ignoreProxy
        ? groups.filter((item) => !ignoredNames.includes(item.name))
        : groups,
    [groups, ignoreProxy]
  )

  const totals = useMemo<TrafficTotals>(
    () =>
      visibleGroups.reduce<TrafficTotals>(
        (accumulator, item) => ({
          bytesIn: accumulator.bytesIn + item.bytesIn,
          bytesOut: accumulator.bytesOut + item.bytesOut,
          total: accumulator.total + item.bytesIn + item.bytesOut,
          processCount: accumulator.processCount + 1,
        }),
        { bytesIn: 0, bytesOut: 0, total: 0, processCount: 0 }
      ),
    [visibleGroups]
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
    setNotice("（演示数据）已刷新")
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
    rangeKind,
    setRangeKind,
    rangeLabel: RANGE_LABELS[rangeKind],
    ignoreProxy,
    setIgnoreProxy,
    groups: visibleGroups,
    hiddenCount: groups.length - visibleGroups.length,
    totals,
    status,
    expanded,
    isExpanded: (name: string) => expanded.includes(name),
    toggleExpanded,
    selected,
    select,
    notice,
    refresh,
    terminate,
    refreshedAt,
  }
}
