import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  MACHINE,
  type ProcessInfo,
} from "@web/features/processes/mock-data"
import {
  useProcessSample,
  useTerminateProcesses,
} from "@web/features/processes/queries"
import {
  useProcessesLocalStore,
  type ProcessScope,
} from "@web/features/processes/store"

const SCOPE_MATCHERS: Record<ProcessScope, (item: ProcessInfo) => boolean> = {
  all: () => true,
  mine: (item) => item.user === MACHINE.user,
  system: (item) => item.user !== MACHINE.user,
  ports: (item) => item.ports.length > 0,
}

/**
 * 进程管理的数据入口。
 *
 * - 远程状态：TanStack Query（进程采样）
 * - 本地共享状态：Zustand（范围筛选、搜索、自动刷新、勾选、详情目标）
 * - 页面级瞬时状态：React state（这里的时钟；表格排序与确认弹窗在各自组件内）
 */
export const useProcesses = () => {
  const local = useProcessesLocalStore()
  const sampleQuery = useProcessSample()
  const terminateProcesses = useTerminateProcesses()
  const [nowMs, setNowMs] = useState(() => Date.now())

  // 运行时长与「上次更新几秒前」需要一个秒级时钟，与采样节奏解耦。
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const processes = useMemo(
    () => sampleQuery.data?.processes ?? [],
    [sampleQuery.data]
  )

  /** 按范围与关键词过滤；排序交给表格组件自己处理。 */
  const filteredProcesses = useMemo(() => {
    const keyword = local.search.trim().toLowerCase()
    const matches = SCOPE_MATCHERS[local.scope]
    return processes.filter((item) => {
      if (!matches(item)) return false
      if (keyword === "") return true
      return (
        item.name.toLowerCase().includes(keyword) ||
        item.user.toLowerCase().includes(keyword) ||
        item.command.toLowerCase().includes(keyword) ||
        String(item.pid).includes(keyword) ||
        item.ports.some((port) => String(port).includes(keyword))
      )
    })
  }, [processes, local.scope, local.search])

  /** 单个进程占用的内存上限，用于把内存条画成相对长度。 */
  const peakMemoryBytes = useMemo(
    () => processes.reduce((max, item) => Math.max(max, item.memoryBytes), 1),
    [processes]
  )

  const checkedProcesses = useMemo(
    () => processes.filter((item) => local.checkedPids.includes(item.pid)),
    [processes, local.checkedPids]
  )

  const checkedSummary = useMemo(() => {
    const cpu = checkedProcesses.reduce((sum, item) => sum + item.cpu, 0)
    const memory = checkedProcesses.reduce(
      (sum, item) => sum + item.memoryBytes,
      0
    )
    return { cpu, memory }
  }, [checkedProcesses])

  const threadCount = useMemo(
    () => processes.reduce((sum, item) => sum + item.threads, 0),
    [processes]
  )

  const refresh = () => {
    void sampleQuery.refetch()
    toast.info("已重新采样进程列表")
  }

  /** 结束进程：成功与失败都通过 toast 汇报。 */
  const terminate = (targets: ProcessInfo[], force: boolean) => {
    if (targets.length === 0) return
    terminateProcesses.mutate(
      { pids: targets.map((item) => item.pid), force },
      {
        onSuccess: (outcome) => {
          const label = force ? "强制结束" : "结束"
          if (outcome.succeeded.length > 0) {
            toast.success(
              `已${label} ${outcome.succeeded
                .map((item) => `${item.name}（${item.pid}）`)
                .join("、")}`
            )
          }
          if (outcome.denied.length > 0) {
            toast.error(
              `${outcome.denied
                .map((item) => item.name)
                .join("、")} 属于系统进程，需要管理员权限，已跳过`
            )
          }
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : String(error))
        },
      }
    )
  }

  const updatedAt = sampleQuery.dataUpdatedAt

  return {
    // 数据
    machine: MACHINE,
    processes,
    filteredProcesses,
    overview: sampleQuery.data?.overview ?? null,
    peakMemoryBytes,
    threadCount,
    isLoading: sampleQuery.isLoading,
    isFetching: sampleQuery.isFetching,
    error:
      sampleQuery.error instanceof Error
        ? sampleQuery.error.message
        : sampleQuery.error === null
          ? null
          : String(sampleQuery.error),
    updatedAt,
    nowMs,
    secondsSinceUpdate: Math.max(0, Math.round((nowMs - updatedAt) / 1000)),

    // 本地共享状态
    scope: local.scope,
    setScope: local.setScope,
    search: local.search,
    setSearch: local.setSearch,
    autoRefresh: local.autoRefresh,
    setAutoRefresh: local.setAutoRefresh,
    checkedPids: local.checkedPids,
    toggleChecked: local.toggleChecked,
    setChecked: local.setChecked,
    selectedPid: local.selectedPid,
    selectProcess: local.selectProcess,

    // 动作与派生量
    refresh,
    terminate,
    checkedProcesses,
    checkedSummary,
  }
}
