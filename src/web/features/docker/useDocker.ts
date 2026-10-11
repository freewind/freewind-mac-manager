import {
  type ActionResponse,
  type DockerColimaStatus,
  type DockerContainer,
  type DockerContainerCreateBody,
  type DockerContainerCreated,
  type DockerImage,
  type DockerNetwork,
  type DockerOverview,
  type DockerVolume,
  TASK_KINDS,
} from "@shared/api-contract"
import {
  actOnDockerContainer,
  createDockerContainer,
  pullDockerImage,
  removeDockerContainer,
  removeDockerImage,
  removeDockerNetwork,
  removeDockerVolume,
} from "@shared/client-api"
import { describeError, formatTimestamp } from "@shared/format"
import {
  dockerContainerTaskTarget,
  dockerImageTaskTarget,
  dockerNetworkTaskTarget,
  dockerVolumeTaskTarget,
} from "@shared/task-targets"
import { useQueryClient } from "@tanstack/react-query"
import type { ContainerAction, DangerAction } from "@web/features/docker/labels"
import {
  dockerKeys,
  useDockerContainersQuery,
  useDockerImagesQuery,
  useDockerNetworksQuery,
  useDockerOverviewQuery,
  useDockerVolumesQuery,
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

/**
 * 新建容器的编排：成功（201）后刷新列表与概览并提示一次；
 * 受理（202）只关闭表单，进度由任务中心呈现；失败文案（如 409）留在表单里持续展示。
 */
export const useDockerCreateContainer = (
  options: { onSubmitted?: () => void } = {}
) => {
  const refresh = useDockerCacheRefresh()
  const [failure, setFailure] = useState<string | null>(null)

  const action = useTaskAction<
    DockerContainerCreated,
    DockerContainerCreateBody
  >({
    kind: TASK_KINDS.dockerAction,
    target: (body) => dockerContainerTaskTarget(body.name ?? body.image),
    run: async (requestId, body) => {
      setFailure(null)
      try {
        return await createDockerContainer(requestId, body)
      } catch (error) {
        // 本地没有镜像、名称被占用这类 409 要留在表单里，不能只提示一下就消失
        setFailure(describeError(error))
        throw error
      }
    },
    onCompleted: (result) => {
      refresh()
      toast.success(result.message)
      options.onSubmitted?.()
    },
    onAccepted: () => {
      refresh()
      options.onSubmitted?.()
    },
  })

  return {
    action,
    failure,
    clearFailure: (): void => setFailure(null),
  }
}

export type VolumeActionInput = { name: string }
export type NetworkActionInput = { networkId: string }

/**
 * 卷列表与删除编排：被容器使用的卷由界面禁用删除按钮，
 * 后端 409 仍是兜底（前端禁用不是安全边界），失败文案留在页面上持续展示。
 */
export const useDockerVolumes = () => {
  const query = useDockerVolumesQuery()
  const refresh = useDockerCacheRefresh()
  const [pendingRemove, setPendingRemove] = useState<DockerVolume | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const action = useTaskAction<ActionResponse, VolumeActionInput>({
    kind: TASK_KINDS.dockerAction,
    target: (payload) => dockerVolumeTaskTarget(payload.name),
    run: async (requestId, payload) => {
      setFailure(null)
      try {
        return await removeDockerVolume(requestId, { name: payload.name })
      } catch (error) {
        setFailure(describeError(error))
        throw error
      }
    },
    onCompleted: (result) => {
      refresh()
      toast.success(result.message)
    },
  })

  return {
    volumes: query.data?.volumes ?? [],
    isLoading: query.isPending,
    error: query.isError ? describeError(query.error) : null,
    action,
    failure,
    clearFailure: (): void => setFailure(null),
    pendingRemove,
    requestRemove: (volume: DockerVolume): void => {
      setFailure(null)
      setPendingRemove(volume)
    },
    cancelRemove: (): void => {
      setFailure(null)
      setPendingRemove(null)
    },
  }
}

/** 网络列表与删除编排；内置网络由界面上直接禁用（后端也会拒绝）。 */
export const useDockerNetworks = () => {
  const query = useDockerNetworksQuery()
  const refresh = useDockerCacheRefresh()
  const [pendingRemove, setPendingRemove] = useState<DockerNetwork | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const action = useTaskAction<ActionResponse, NetworkActionInput>({
    kind: TASK_KINDS.dockerAction,
    target: (payload) => dockerNetworkTaskTarget(payload.networkId),
    run: async (requestId, payload) => {
      setFailure(null)
      try {
        return await removeDockerNetwork(requestId, {
          networkId: payload.networkId,
        })
      } catch (error) {
        setFailure(describeError(error))
        throw error
      }
    },
    onCompleted: (result) => {
      refresh()
      toast.success(result.message)
    },
  })

  return {
    networks: query.data?.networks ?? [],
    isLoading: query.isPending,
    error: query.isError ? describeError(query.error) : null,
    action,
    failure,
    clearFailure: (): void => setFailure(null),
    pendingRemove,
    requestRemove: (network: DockerNetwork): void => {
      setFailure(null)
      setPendingRemove(network)
    },
    cancelRemove: (): void => {
      setFailure(null)
      setPendingRemove(null)
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
