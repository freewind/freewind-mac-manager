import { describeError } from "@shared/format"
import { useQueryClient } from "@tanstack/react-query"
import { buildPortGroups, type PortGroup } from "@web/features/ports/domain"
import {
  portKeys,
  useKillPortProcesses,
  usePortBindings,
} from "@web/features/ports/queries"
import {
  PORT_VIEWS,
  type PortExposureFilter,
  type PortView,
  usePortsLocalStore,
} from "@web/features/ports/store"
import { useMemo } from "react"
import { toast } from "sonner"

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

/**
 * 端口管理的数据入口。
 *
 * - 远程状态：TanStack Query（端口绑定）
 * - 本地共享状态：Zustand（快捷视图、搜索、筛选、展开、选中、自动刷新）
 * - 页面级瞬时状态：React state（这里的提示；表格排序在表格组件内）
 */
export const usePorts = () => {
  const queryClient = useQueryClient()
  const local = usePortsLocalStore()
  const notify = (text: string) => toast.success(text)

  const bindingsQuery = usePortBindings()
  const killPortProcesses = useKillPortProcesses()

  const bindings = useMemo(() => bindingsQuery.data ?? [], [bindingsQuery.data])

  // 按状态与协议先在套接字层过滤，再聚合成端口分组。
  const scopedBindings = useMemo(
    () =>
      bindings.filter((item) => {
        if (local.scope === "listening" && item.state !== "LISTEN") return false
        if (local.scope === "connected" && item.state !== "ESTABLISHED") {
          return false
        }
        if (local.protocol !== "all" && item.protocol !== local.protocol) {
          return false
        }
        return true
      }),
    [bindings, local.scope, local.protocol]
  )

  const allGroups = useMemo(
    () => buildPortGroups(scopedBindings),
    [scopedBindings]
  )

  const searchedGroups = useMemo(() => {
    const keyword = local.search.trim().toLowerCase()
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
  }, [allGroups, local.search])

  const groups = useMemo(
    () =>
      searchedGroups.filter(
        (group) =>
          matchesView(group, local.view) &&
          matchesExposure(group, local.exposure)
      ),
    [searchedGroups, local.view, local.exposure]
  )

  // 快捷视图计数跟随当前搜索与暴露筛选，保证数字与切换后的结果一致。
  const viewCounts = useMemo(() => {
    const counts = {} as Record<PortView, number>
    for (const item of PORT_VIEWS) {
      counts[item.key] = searchedGroups.filter(
        (group) =>
          matchesView(group, item.key) && matchesExposure(group, local.exposure)
      ).length
    }
    return counts
  }, [searchedGroups, local.exposure])

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

  /** 让缓存里的端口列表重新拉一次。 */
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: portKeys.bindings })
    notify("端口列表已更新")
  }

  const terminate = (port: number, pids: number[]) => {
    killPortProcesses.mutate(
      { port, pids },
      {
        onSuccess: (response) => {
          const killed = response.results.filter(
            (item) => item.succeeded
          ).length
          notify(
            `端口 ${port}：已结束 ${killed} 个进程，${pids.length - killed} 个跳过`
          )
        },
        onError: (error) => toast.error(describeError(error)),
      }
    )
  }

  return {
    // 数据
    groups,
    totals,
    viewCounts,
    isLoading: bindingsQuery.isLoading,
    error: bindingsQuery.error,
    updatedAt: bindingsQuery.dataUpdatedAt,

    // 本地共享状态
    view: local.view,
    setView: local.setView,
    search: local.search,
    setSearch: local.setSearch,
    protocol: local.protocol,
    setProtocol: local.setProtocol,
    scope: local.scope,
    setScope: local.setScope,
    exposure: local.exposure,
    setExposure: local.setExposure,
    isExpanded: (port: number) => local.expandedPorts.includes(port),
    toggleExpanded: local.toggleExpanded,
    selectedPort: local.selectedPort,
    selectPort: local.selectPort,
    autoRefresh: local.autoRefresh,
    setAutoRefresh: local.setAutoRefresh,

    // 动作
    refresh,
    terminate,
    /** 结束进程进行中：同一次操作不能重复提交。 */
    killBusy: killPortProcesses.isPending,
    notify,
  }
}
