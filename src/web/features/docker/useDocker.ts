import type { DockerColimaStatus, DockerOverview } from "@shared/api-contract"
import { describeError, formatTimestamp } from "@shared/format"
import { useDockerOverviewQuery } from "@web/features/docker/queries"

/** Colima 的展示状态：未安装与未运行要分开，处理方式完全不同。 */
export const colimaStateOf = (
  colima: DockerColimaStatus
): "running" | "stopped" | "missing" => {
  if (!colima.installed) return "missing"
  return colima.running ? "running" : "stopped"
}

export type DockerPageModel = {
  overview: DockerOverview | null
  /** 首次加载中（还没有任何数据可渲染） */
  isLoading: boolean
  /** 后台刷新中（已有旧数据） */
  isRefreshing: boolean
  /** 持续错误：在页面上展示，不用 toast 代替 */
  error: string | null
  /** 数据时间：历史快照必须标明时间 */
  sampledAt: string | null
  refresh: () => void
}

/**
 * 概览页的数据编排。
 * 动作（容器/镜像/卷/网络/Colima 的写操作）在后续任务接入，
 * 这里只负责读取与状态表达。
 */
export const useDocker = (): DockerPageModel => {
  const query = useDockerOverviewQuery()
  const overview = query.data ?? null

  return {
    overview,
    isLoading: query.isPending,
    isRefreshing: query.isFetching && !query.isPending,
    error: query.isError ? describeError(query.error) : null,
    sampledAt: overview ? formatTimestamp(overview.checkedAt / 1000) : null,
    refresh: () => {
      void query.refetch()
    },
  }
}
