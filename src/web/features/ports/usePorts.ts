import { useEffect, useMemo, useState } from "react"
import {
  buildPortGroups,
  mockPortBindings,
  type PortBinding,
  type PortCategory,
  type PortGroup,
  type PortProtocol,
} from "@web/features/ports/mock-data"

/** 左侧快捷视图：状态、暴露面与分类的快捷筛选。 */
export type PortView =
  | "all"
  | "listening"
  | "connected"
  | "exposed"
  | PortCategory

export const PORT_VIEWS: { key: PortView; label: string }[] = [
  { key: "all", label: "全部端口" },
  { key: "listening", label: "监听中" },
  { key: "connected", label: "已建立连接" },
  { key: "exposed", label: "对外暴露" },
  { key: "dev", label: "开发服务" },
  { key: "database", label: "数据库" },
  { key: "proxy", label: "代理 / 网关" },
  { key: "system", label: "系统进程" },
  { key: "app", label: "其他应用" },
]

export type PortProtocolFilter = "all" | PortProtocol
export type PortScopeFilter = "all" | "listening" | "connected"
export type PortExposureFilter = "all" | "local" | "exposed"
export type PortSortKey = "port" | "processCount" | "service"

/** 自动刷新间隔（秒）。 */
export const REFRESH_INTERVAL_SECONDS = 5

const matchesView = (group: PortGroup, view: PortView): boolean => {
  switch (view) {
    case "all":
      return true
    case "listening":
      return group.state === "LISTEN"
    case "connected":
      return group.state === "ESTABLISHED"
    case "exposed":
      return group.exposed
    default:
      return group.category === view
  }
}

const matchesExposure = (
  group: PortGroup,
  exposure: PortExposureFilter
): boolean => {
  if (exposure === "exposed") return group.exposed
  if (exposure === "local") return !group.exposed
  return true
}

/** 端口管理的视图状态：筛选、搜索、排序、展开、复制与结束进程。 */
export const usePorts = () => {
  const [bindings, setBindings] = useState<PortBinding[]>(mockPortBindings)
  const [view, setView] = useState<PortView>("all")
  const [search, setSearch] = useState("")
  const [protocol, setProtocol] = useState<PortProtocolFilter>("all")
  const [scope, setScope] = useState<PortScopeFilter>("all")
  const [exposure, setExposure] = useState<PortExposureFilter>("all")
  const [sortKey, setSortKey] = useState<PortSortKey>("port")
  const [descending, setDescending] = useState(false)
  const [expanded, setExpanded] = useState<number[]>([5173])
  const [selected, setSelected] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [refreshedAt, setRefreshedAt] = useState(() => Date.now())

  // 按状态与协议先在套接字层过滤，再聚合成端口分组。
  const scopedBindings = useMemo(
    () =>
      bindings.filter((item) => {
        if (scope === "listening" && item.state !== "LISTEN") return false
        if (scope === "connected" && item.state !== "ESTABLISHED") return false
        if (protocol !== "all" && item.protocol !== protocol) return false
        return true
      }),
    [bindings, scope, protocol]
  )

  const allGroups = useMemo(
    () => buildPortGroups(scopedBindings),
    [scopedBindings]
  )

  const searchedGroups = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return allGroups
    return allGroups.filter(
      (group) =>
        String(group.port).includes(keyword) ||
        group.service.label.toLowerCase().includes(keyword) ||
        group.processNames.some((name) =>
          name.toLowerCase().includes(keyword)
        ) ||
        group.bindings.some(
          (item) =>
            item.command.toLowerCase().includes(keyword) ||
            item.cwd.toLowerCase().includes(keyword)
        )
    )
  }, [allGroups, search])

  const groups = useMemo(
    () =>
      searchedGroups.filter(
        (group) =>
          matchesView(group, view) && matchesExposure(group, exposure)
      ),
    [searchedGroups, view, exposure]
  )

  // 快捷视图计数跟随当前搜索与暴露筛选，保证数字与切换后的结果一致。
  const viewCounts = useMemo(() => {
    const counts = {} as Record<PortView, number>
    for (const item of PORT_VIEWS) {
      counts[item.key] = searchedGroups.filter(
        (group) =>
          matchesView(group, item.key) && matchesExposure(group, exposure)
      ).length
    }
    return counts
  }, [searchedGroups, exposure])

  const sortedGroups = useMemo(() => {
    const factor = descending ? -1 : 1
    return [...groups].sort((left, right) => {
      if (sortKey === "port") return (left.port - right.port) * factor
      if (sortKey === "processCount") {
        return (left.pids.length - right.pids.length) * factor
      }
      return left.service.label.localeCompare(right.service.label) * factor
    })
  }, [groups, sortKey, descending])

  const totals = useMemo(
    () => ({
      listening: groups.filter((group) => group.state === "LISTEN").length,
      connected: groups.filter((group) => group.state === "ESTABLISHED").length,
      exposed: groups.filter((group) => group.exposed).length,
      processCount: new Set(groups.flatMap((group) => group.pids)).size,
      bindings: groups.reduce((sum, group) => sum + group.bindings.length, 0),
    }),
    [groups]
  )

  useEffect(() => {
    if (!autoRefresh) return
    const timer = setInterval(
      () => setRefreshedAt(Date.now()),
      REFRESH_INTERVAL_SECONDS * 1000
    )
    return () => clearInterval(timer)
  }, [autoRefresh])

  const toggleSort = (key: PortSortKey) => {
    if (key === sortKey) {
      setDescending((previous) => !previous)
      return
    }
    setSortKey(key)
    setDescending(key !== "port")
  }

  const toggleExpanded = (port: number) => {
    setExpanded((previous) =>
      previous.includes(port)
        ? previous.filter((item) => item !== port)
        : [...previous, port]
    )
  }

  const select = (port: number) => {
    setSelected((previous) => (previous === port ? null : port))
  }

  const refresh = () => {
    setRefreshedAt(Date.now())
    setNotice("端口列表已更新")
  }

  const notify = (text: string) => setNotice(text)

  const terminate = (port: number, pids: number[]) => {
    const target = new Set(pids)
    setBindings((previous) =>
      previous.filter(
        (item) => !(item.port === port && target.has(item.pid))
      )
    )
    setNotice(`已结束端口 ${port} 上的 ${pids.length} 个进程：${pids.join(", ")}`)
  }

  return {
    groups: sortedGroups,
    view,
    setView,
    viewCounts,
    search,
    setSearch,
    protocol,
    setProtocol,
    scope,
    setScope,
    exposure,
    setExposure,
    sortKey,
    descending,
    toggleSort,
    expanded,
    isExpanded: (port: number) => expanded.includes(port),
    toggleExpanded,
    selected,
    select,
    totals,
    notice,
    notify,
    refresh,
    terminate,
    autoRefresh,
    setAutoRefresh,
    refreshedAt,
  }
}
