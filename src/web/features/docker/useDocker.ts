import {
  type ActionResponse,
  type DockerColimaStatus,
  type DockerContainer,
  type DockerImage,
  type DockerOverview,
  TASK_KINDS,
} from "@shared/api-contract"
import {
  actOnDockerContainer,
  pullDockerImage,
  removeDockerContainer,
  removeDockerImage,
} from "@shared/client-api"
import { describeError, formatTimestamp } from "@shared/format"
import {
  dockerContainerTaskTarget,
  dockerImageTaskTarget,
} from "@shared/task-targets"
import { useQueryClient } from "@tanstack/react-query"
import type { ContainerAction, DangerAction } from "@web/features/docker/labels"
import {
  dockerKeys,
  useDockerContainersQuery,
  useDockerImagesQuery,
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

/**
 * Docker 写操作可能改变任何一类资源（容器/镜像/卷/网络）与概览计数，
 * 因此统一失效整个 docker 前缀的只读查询；日志键也在前缀内，随页面挂载情况刷新。
 *
 * registerTaskCompletion 是同一 kind 覆盖注册：只能有一处注册，避免后注册的覆盖前者。
 */
export const useDockerCacheRefresh = (): (() => void) => {
  const queryClient = useQueryClient()
  const refresh = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: ["docker"] })
  }, [queryClient])

  useEffect(() => {
    registerTaskCompletion(TASK_KINDS.dockerAction, refresh)
  }, [refresh])

  return refresh
}

export type ImageActionInput = {
  image: string
  action: "pull" | "remove"
  /** 只对删除有意义：被容器引用时必须显式 force 才强删 */
  force?: boolean
}

/**
 * 镜像列表与拉取/删除编排。
 *
 * - 拉取只提交任务：进度由任务中心呈现，这里不伪造百分比。
 * - 删除被引用时后端返回 409，错误留在页面上持续展示，不靠 toast 一闪而过。
 */
export const useDockerImages = () => {
  const queryClient = useQueryClient()
  const query = useDockerImagesQuery()
  const refresh = useDockerCacheRefresh()
  const [pendingRemove, setPendingRemove] = useState<DockerImage | null>(null)
  const [pullOpen, setPullOpen] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const action = useTaskAction<ActionResponse, ImageActionInput>({
    kind: TASK_KINDS.dockerAction,
    target: (payload) => dockerImageTaskTarget(payload.image),
    run: async (requestId, payload) => {
      setFailure(null)
      try {
        return payload.action === "remove"
          ? await removeDockerImage(requestId, {
              imageId: payload.image,
              force: payload.force,
            })
          : await pullDockerImage(requestId, { image: payload.image })
      } catch (error) {
        // 失败原因（例如被容器引用）要留在页面上，不能只提示一下就消失
        setFailure(describeError(error))
        throw error
      }
    },
    onCompleted: (result) => {
      refresh()
      // 成功提示只在编排处触发一次
      toast.success(result.message)
    },
  })

  return {
    images: query.data?.images ?? [],
    isLoading: query.isPending,
    isRefreshing: query.isFetching && !query.isPending,
    error: query.isError ? describeError(query.error) : null,
    action,
    /** 上一次动作的失败原因：在页面上持续展示 */
    failure,
    clearFailure: (): void => setFailure(null),
    pendingRemove,
    requestRemove: (image: DockerImage): void => {
      setFailure(null)
      setPendingRemove(image)
    },
    cancelRemove: (): void => {
      setFailure(null)
      setPendingRemove(null)
    },
    pullOpen,
    openPull: (): void => {
      setFailure(null)
      setPullOpen(true)
    },
    closePull: (): void => {
      setFailure(null)
      setPullOpen(false)
    },
    refreshImages: (): void => {
      void queryClient.invalidateQueries({ queryKey: dockerKeys.images })
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
  const query = useDockerContainersQuery()
  const [pendingDanger, setPendingDanger] = useState<{
    container: DockerContainer
    action: DangerAction
  } | null>(null)

  // 动作改了真实状态：Docker 域的只读数据全部重新读取
  const refresh = useDockerCacheRefresh()

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
