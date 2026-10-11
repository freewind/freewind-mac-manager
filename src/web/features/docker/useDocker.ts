import {
  type ActionResponse,
  type DockerColimaStatus,
  type DockerContainer,
  type DockerOverview,
  TASK_KINDS,
} from "@shared/api-contract"
import { actOnDockerContainer, removeDockerContainer } from "@shared/client-api"
import { describeError, formatTimestamp } from "@shared/format"
import { dockerContainerTaskTarget } from "@shared/task-targets"
import { useQueryClient } from "@tanstack/react-query"
import type { ContainerAction, DangerAction } from "@web/features/docker/labels"
import {
  dockerKeys,
  useDockerContainersQuery,
  useDockerOverviewQuery,
} from "@web/features/docker/queries"
import { registerTaskCompletion } from "@web/features/tasks/completion"
import { useTaskAction } from "@web/hooks/use-task-action"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

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

export type ContainerActionInput = {
  containerId: string
  action: ContainerAction
  /** 只对 stop/restart/remove 有意义；删除运行中的容器必须显式带 force */
  force?: boolean
}

/**
 * 容器列表与动作编排。
 *
 * 动作全部复用 use-task-action：请求标识由它生成，受理与结果未知的语义也在那里，
 * 这里只负责把载荷映射到 client-api 的具名调用，并在完成时失效 Docker 缓存。
 */
export const useDockerContainers = () => {
  const queryClient = useQueryClient()
  const query = useDockerContainersQuery()
  const [pendingDanger, setPendingDanger] = useState<{
    container: DockerContainer
    action: DangerAction
  } | null>(null)

  // 动作改了真实状态：概览与列表都要重新读取
  const refresh = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: dockerKeys.containers })
    void queryClient.invalidateQueries({ queryKey: dockerKeys.overview })
  }, [queryClient])

  // 慢路径（受理后由任务终态触发）同样要刷新
  useEffect(() => {
    registerTaskCompletion(TASK_KINDS.dockerAction, refresh)
  }, [refresh])

  const action = useTaskAction<ActionResponse, ContainerActionInput>({
    kind: TASK_KINDS.dockerAction,
    target: (payload) => dockerContainerTaskTarget(payload.containerId),
    run: (requestId, payload) =>
      payload.action === "remove"
        ? removeDockerContainer(requestId, {
            containerId: payload.containerId,
            force: payload.force,
          })
        : actOnDockerContainer(requestId, {
            containerId: payload.containerId,
            action: payload.action,
            force: payload.force,
          }),
    onCompleted: (result) => {
      refresh()
      // 成功提示只在这里触发一次（受理与结果未知不提示成功）
      toast.success(result.message)
    },
  })

  return {
    containers: query.data?.containers ?? [],
    skipped: query.data?.skipped ?? [],
    isLoading: query.isPending,
    isRefreshing: query.isFetching && !query.isPending,
    error: query.isError ? describeError(query.error) : null,
    action,
    /** 待二次确认的危险动作（删除 / 立即终止）：确认前不发任何请求 */
    pendingDanger,
    requestDanger: (container: DockerContainer, danger: DangerAction): void =>
      setPendingDanger({ container, action: danger }),
    cancelDanger: (): void => setPendingDanger(null),
  }
}
