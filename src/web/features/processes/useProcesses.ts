import type { ProcessEntry } from "@shared/api-contract"
import { describeError } from "@shared/format"
import {
  useKillProcesses,
  useProcessList,
} from "@web/features/processes/queries"
import {
  type ProcessScope,
  useProcessesLocalStore,
} from "@web/features/processes/store"
import { useMemo, useSyncExternalStore } from "react"
import { toast } from "sonner"

let clockMs = Date.now()

const subscribeClock = (onChange: () => void): (() => void) => {
  const timer = window.setInterval(() => {
    clockMs = Date.now()
    onChange()
  }, 1000)
  return () => window.clearInterval(timer)
}

const getClock = () => clockMs

const useNowMs = () => useSyncExternalStore(subscribeClock, getClock, getClock)

const SCOPE_MATCHES: Record<
  ProcessScope,
  (item: ProcessEntry, user: string) => boolean
> = {
  all: () => true,
  mine: (item, user) => item.user === user,
  system: (item, user) => item.user !== user,
  ports: (item) => item.ports.length > 0,
}

/**
 * 进程管理的数据入口。
 *
 * - 远程状态：TanStack Query（进程采样）
 * - 本地共享状态：Zustand（范围筛选、搜索、自动刷新、勾选、详情目标）
 * - 组件局部状态：React state（这里的秒级时钟；表格排序与确认弹窗在各自组件内）
 */
export const useProcesses = () => {
  const local = useProcessesLocalStore()
  const listQuery = useProcessList()
  const killMutation = useKillProcesses()
  const nowMs = useNowMs()

  const processes = useMemo(
    () => listQuery.data?.processes ?? [],
    [listQuery.data]
  )
  const overview = listQuery.data?.overview ?? null
  const currentUser = listQuery.data?.currentUser ?? ""

  /** 按范围与关键词过滤；排序交给表格组件自己处理。 */
  const filteredProcesses = useMemo(() => {
    const keyword = local.search.trim().toLowerCase()
    const matches = SCOPE_MATCHES[local.scope]
    return processes.filter((item) => {
      if (!matches(item, currentUser)) return false
      if (keyword === "") return true
      return (
        item.name.toLowerCase().includes(keyword) ||
        item.user.toLowerCase().includes(keyword) ||
        item.command.toLowerCase().includes(keyword) ||
        String(item.pid).includes(keyword) ||
        item.ports.some((port) => String(port).includes(keyword))
      )
    })
  }, [processes, local.scope, local.search, currentUser])

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
    () => processes.reduce((sum, item) => sum + (item.threads ?? 0), 0),
    [processes]
  )

  const refresh = () => {
    void listQuery.refetch()
    toast.info("已重新采样进程列表")
  }

  /** 结束进程：逐条汇报成功与失败原因。 */
  const terminate = (targets: ProcessEntry[], force: boolean) => {
    if (targets.length === 0) return
    const names = new Map(targets.map((item) => [item.pid, item.name]))
    killMutation.mutate(
      { pids: targets.map((item) => item.pid), force },
      {
        onSuccess: (outcome) => {
          const label = force ? "强制结束" : "结束"
          const done = outcome.results.filter((item) => item.succeeded)
          const failed = outcome.results.filter((item) => !item.succeeded)
          if (done.length > 0) {
            toast.success(
              `已${label} ${done
                .map(
                  (item) => `${names.get(item.pid) ?? "进程"}（${item.pid}）`
                )
                .join("、")}`
            )
          }
          if (failed.length > 0) {
            toast.error(
              failed
                .map(
                  (item) =>
                    `${names.get(item.pid) ?? "进程"}（${item.pid}）：${item.message}`
                )
                .join("；")
            )
          }
        },
        onError: (error) => {
          toast.error(describeError(error))
        },
      }
    )
  }

  const updatedAt = listQuery.dataUpdatedAt

  return {
    // 数据
    processes,
    filteredProcesses,
    overview,
    currentUser,
    peakMemoryBytes,
    threadCount,
    isLoading: listQuery.isLoading,
    isFetching: listQuery.isFetching,
    error: listQuery.isError ? describeError(listQuery.error) : null,
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
    /** 结束进程进行中：同一次操作不能重复提交。 */
    killBusy: killMutation.isPending,
    checkedProcesses,
    checkedSummary,
  }
}
