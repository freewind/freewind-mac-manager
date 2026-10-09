import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  MACHINE,
  REFRESH_INTERVAL_SECONDS,
  mockOverview,
  mockProcesses,
  type ProcessInfo,
  type SystemOverview,
} from "@web/features/processes/mock-data"

/** CPU 曲线保留的采样点数量。 */
const HISTORY_SIZE = 28

export type ProcessSortKey =
  | "cpu"
  | "memory"
  | "name"
  | "pid"
  | "threads"
  | "started"

export type ProcessScope = "all" | "mine" | "system" | "ports"

const SCOPE_MATCHERS: Record<ProcessScope, (item: ProcessInfo) => boolean> = {
  all: () => true,
  mine: (item) => item.user === MACHINE.user,
  system: (item) => item.user !== MACHINE.user,
  ports: (item) => item.ports.length > 0,
}

export const useProcesses = () => {
  const [tick, setTick] = useState(0)
  const [processes, setProcesses] = useState<ProcessInfo[]>(() =>
    mockProcesses(0)
  )
  const [overview, setOverview] = useState<SystemOverview>(() =>
    mockOverview(mockProcesses(0), 0)
  )
  const [cpuHistory, setCpuHistory] = useState<number[]>([])
  const [updatedAt, setUpdatedAt] = useState(() => Date.now())
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [scope, setScope] = useState<ProcessScope>("all")
  const [keyword, setKeyword] = useState("")
  const [sortKey, setSortKey] = useState<ProcessSortKey>("cpu")
  const [descending, setDescending] = useState(true)
  const [checked, setChecked] = useState<number[]>([])
  const [selected, setSelected] = useState<ProcessInfo | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** 已经结束的进程，后续采样不再把它们带回来。 */
  const killed = useRef<Set<number>>(new Set())

  // 每次采样推进一个 tick，并把新数据覆盖到列表上。
  useEffect(() => {
    const list = mockProcesses(tick).filter((item) => !killed.current.has(item.pid))
    const next = mockOverview(list, tick)
    setProcesses(list)
    setOverview(next)
    setCpuHistory((previous) => [...previous, next.cpuTotal].slice(-HISTORY_SIZE))
    setUpdatedAt(Date.now())
  }, [tick])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = setInterval(() => setTick((value) => value + 1), REFRESH_INTERVAL_SECONDS * 1000)
    return () => clearInterval(timer)
  }, [autoRefresh])

  // 单独走一个更快的时钟，用于「运行时长」与「上次更新」这类秒级文案。
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 500)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [notice])

  const refresh = useCallback(() => setTick((value) => value + 1), [])

  const compare = useCallback(
    (left: ProcessInfo, right: ProcessInfo): number => {
      const direction = descending ? -1 : 1
      switch (sortKey) {
        case "name":
          return left.name.localeCompare(right.name) * direction
        case "memory":
          return (left.memoryBytes - right.memoryBytes) * direction
        case "threads":
          return (left.threads - right.threads) * direction
        case "pid":
          return (left.pid - right.pid) * direction
        case "started":
          return (left.startedAt - right.startedAt) * direction
        case "cpu":
          return (left.cpu - right.cpu) * direction
      }
    },
    [sortKey, descending]
  )

  const toggleSort = useCallback(
    (key: ProcessSortKey) => {
      if (key === sortKey) {
        setDescending((value) => !value)
        return
      }
      setSortKey(key)
      setDescending(key !== "name")
    },
    [sortKey]
  )

  const rows = useMemo(() => {
    const keywordText = keyword.trim().toLowerCase()
    const matches = SCOPE_MATCHERS[scope]
    return processes
      .filter((item) => {
        if (!matches(item)) return false
        if (keywordText === "") return true
        return (
          item.name.toLowerCase().includes(keywordText) ||
          item.user.toLowerCase().includes(keywordText) ||
          item.command.toLowerCase().includes(keywordText) ||
          String(item.pid).includes(keywordText) ||
          item.ports.some((port) => String(port).includes(keywordText))
        )
      })
      .sort(compare)
  }, [processes, scope, keyword, compare])

  /** 单个进程占用的内存上限，用于把内存条画成相对长度。 */
  const peakMemoryBytes = useMemo(
    () => processes.reduce((max, item) => Math.max(max, item.memoryBytes), 1),
    [processes]
  )

  const terminate = useCallback((targets: ProcessInfo[], force: boolean) => {
    if (targets.length === 0) return
    const allowed = targets.filter(
      (item) => item.user === MACHINE.user && item.kind !== "kernel"
    )
    const denied = targets.filter((item) => !allowed.includes(item))
    for (const item of allowed) killed.current.add(item.pid)
    if (allowed.length > 0) {
      setProcesses((previous) =>
        previous.filter((item) => !killed.current.has(item.pid))
      )
      setChecked((previous) =>
        previous.filter((pid) => !killed.current.has(pid))
      )
      setSelected((previous) =>
        previous && killed.current.has(previous.pid) ? null : previous
      )
    }
    const parts: string[] = []
    if (allowed.length > 0) {
      parts.push(
        `已${force ? "强制结束" : "结束"} ${allowed
          .map((item) => `${item.name}（${item.pid}）`)
          .join("、")}`
      )
    }
    if (denied.length > 0) {
      parts.push(
        `${denied.map((item) => item.name).join("、")} 属于系统进程，需要管理员权限，已跳过`
      )
    }
    setNotice(parts.join("；"))
  }, [])

  const toggleChecked = useCallback((pid: number, next: boolean) => {
    setChecked((previous) =>
      next
        ? previous.includes(pid)
          ? previous
          : [...previous, pid]
        : previous.filter((value) => value !== pid)
    )
  }, [])

  const setAllChecked = useCallback(
    (next: boolean) => setChecked(next ? rows.map((item) => item.pid) : []),
    [rows]
  )

  const clearChecked = useCallback(() => setChecked([]), [])

  const terminateChecked = useCallback(
    (force: boolean) =>
      terminate(
        processes.filter((item) => checked.includes(item.pid)),
        force
      ),
    [processes, checked, terminate]
  )

  return {
    machine: MACHINE,
    all: processes,
    rows,
    overview,
    cpuHistory,
    /** 全列表的进程数（不受筛选影响）。 */
    total: processes.length,
    updatedAt,
    nowMs,
    secondsSinceUpdate: Math.max(0, Math.round((nowMs - updatedAt) / 1000)),
    autoRefresh,
    toggleAutoRefresh: () => setAutoRefresh((value) => !value),
    refresh,
    scope,
    setScope,
    keyword,
    setKeyword,
    sortKey,
    descending,
    toggleSort,
    checked,
    toggleChecked,
    setAllChecked,
    clearChecked,
    terminateChecked,
    terminate,
    peakMemoryBytes,
    selected,
    openDetail: setSelected,
    closeDetail: () => setSelected(null),
    notice,
  }
}
