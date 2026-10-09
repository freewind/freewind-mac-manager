import { useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { describeError } from "@shared/format"
import type { ServiceDomain, SystemService } from "@shared/api-contract"
import { revealSystemService } from "@shared/client-api"
import {
  CONFIRM_REQUIRED,
  type ServiceAction,
} from "@web/features/system-services/actions"
import {
  systemServiceKeys,
  useServiceAction,
  useServicesQuery,
} from "@web/features/system-services/queries"
import { useSystemServicesLocalStore } from "@web/features/system-services/store"

export type PendingAction = {
  action: ServiceAction
  label: string
  domain: ServiceDomain
}

/**
 * 系统服务页的数据入口。
 *
 * - 远程状态：TanStack Query（服务列表与各类操作）
 * - 本地共享状态：Zustand（选中、搜索词、两个筛选）
 * - 页面级瞬时状态：React state（这里的提示与待确认动作）
 */
export const useSystemServices = () => {
  const queryClient = useQueryClient()
  const local = useSystemServicesLocalStore()
  const [pending, setPending] = useState<PendingAction | null>(null)

  const servicesQuery = useServicesQuery()
  const serviceAction = useServiceAction()

  const services = useMemo(
    () => servicesQuery.data?.services ?? [],
    [servicesQuery.data]
  )
  const skipped = servicesQuery.data?.skipped ?? []

  const filtered = useMemo(() => {
    const needle = local.keyword.trim().toLowerCase()
    return services.filter((service) => {
      if (local.stateFilter !== "all" && service.state !== local.stateFilter) {
        return false
      }
      if (
        local.domainFilter !== "all" &&
        service.domain !== local.domainFilter
      ) {
        return false
      }
      if (needle.length === 0) return true
      return (
        service.label.toLowerCase().includes(needle) ||
        service.program.toLowerCase().includes(needle) ||
        service.filePath.toLowerCase().includes(needle)
      )
    })
  }, [services, local.keyword, local.stateFilter, local.domainFilter])

  const selected =
    services.find((service) => service.label === local.selectedLabel) ??
    services[0] ??
    null

  const stats = useMemo(
    () => ({
      total: services.length,
      running: services.filter((item) => item.state === "running").length,
      stopped: services.filter((item) => item.state === "stopped").length,
      failed: services.filter((item) => item.state === "failed").length,
      disabled: services.filter((item) => item.state === "disabled").length,
      requiresRoot: services.filter((item) => item.requiresRoot).length,
    }),
    [services]
  )

  const run = (action: ServiceAction, target: SystemService) => {
    serviceAction.mutate(
      { label: target.label, domain: target.domain, action },
      {
        onSuccess: (data) => toast.success(data.message),
        onError: (error) => toast.error(describeError(error)),
      }
    )
  }

  /** 入口：需要确认的先弹窗，其余直接执行。 */
  const requestAction = (action: ServiceAction, target: SystemService) => {
    if (target.requiresRoot) {
      toast.error(
        `${target.label} 位于系统目录，需要 root 权限；此处只提供查看与复制。`
      )
      return
    }
    if (CONFIRM_REQUIRED.includes(action)) {
      setPending({ action, label: target.label, domain: target.domain })
      return
    }
    run(action, target)
  }

  const pendingTarget = pending
    ? (services.find(
        (service) =>
          service.label === pending.label && service.domain === pending.domain
      ) ?? null)
    : null

  const confirmPending = () => {
    if (!pending || !pendingTarget) return
    run(pending.action, pendingTarget)
    setPending(null)
  }

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: systemServiceKeys.list })
    toast.success(`已重新读取 ${services.length} 个 plist 与 launchd 状态`)
  }

  const reveal = (target: SystemService) => {
    void revealSystemService({ label: target.label, domain: target.domain })
      .then((result) => toast.success(result.message))
      .catch((error) => toast.error(describeError(error)))
  }

  const copy = (text: string, what: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success(`已复制${what}`))
      .catch((error) => toast.error(`复制失败：${describeError(error)}`))
  }

  return {
    // 数据
    services,
    filtered,
    skipped,
    selected,
    stats,
    isLoading: servicesQuery.isLoading,
    isFetching: servicesQuery.isFetching,
    error: servicesQuery.isError ? describeError(servicesQuery.error) : null,
    isPending: serviceAction.isPending,

    // 本地共享状态
    selectedLabel: selected?.label ?? null,
    selectService: local.selectService,
    keyword: local.keyword,
    setKeyword: local.setKeyword,
    stateFilter: local.stateFilter,
    setStateFilter: local.setStateFilter,
    domainFilter: local.domainFilter,
    setDomainFilter: local.setDomainFilter,

    // 动作
    requestAction,
    pending,
    cancelPending: () => setPending(null),
    confirmPending,
    refresh,
    reveal,
    copy,
  }
}
