import type {
  ActionResponse,
  DockerColimaActionBody,
  DockerColimaStatus,
  DockerContainerActionBody,
  DockerContainerCreateBody,
  DockerContainerCreated,
  DockerContainerDeleteBody,
  DockerContainerLogsQuery,
  DockerContainerLogsResponse,
  DockerContainersResponse,
  DockerImageDeleteBody,
  DockerImagePullBody,
  DockerImagesResponse,
  DockerNetworkDeleteBody,
  DockerNetworksResponse,
  DockerOverview,
  DockerVolumeDeleteBody,
  DockerVolumesResponse,
} from "@shared/api-contract"
import { apiClient, taskRequestHeaders, unwrap } from "./client"
import { type Execution, runExecution } from "./execution"

// ---- 只读查询：数据只从后端读取，前端不缓存到本地 store ----

export const fetchDockerOverview = async (): Promise<DockerOverview> =>
  unwrap<DockerOverview>(await apiClient.getDockerOverview())

export const fetchDockerContainers =
  async (): Promise<DockerContainersResponse> =>
    unwrap<DockerContainersResponse>(await apiClient.listDockerContainers())

/** 日志只按需读取：调用方决定 tail 与是否重新拉取。 */
export const fetchDockerContainerLogs = async (
  query: DockerContainerLogsQuery
): Promise<DockerContainerLogsResponse> =>
  unwrap<DockerContainerLogsResponse>(
    await apiClient.getDockerContainerLogs({ query })
  )

export const fetchDockerImages = async (): Promise<DockerImagesResponse> =>
  unwrap<DockerImagesResponse>(await apiClient.listDockerImages())

export const fetchDockerVolumes = async (): Promise<DockerVolumesResponse> =>
  unwrap<DockerVolumesResponse>(await apiClient.listDockerVolumes())

export const fetchDockerNetworks = async (): Promise<DockerNetworksResponse> =>
  unwrap<DockerNetworksResponse>(await apiClient.listDockerNetworks())

export const fetchDockerColimaStatus = async (): Promise<DockerColimaStatus> =>
  unwrap<DockerColimaStatus>(await apiClient.getDockerColimaStatus())

/**
 * 容器动作都由请求标识驱动：服务端据此复用任务，重发不会变成第二次执行。
 * 命令执行完只说明命令跑完了，是否真的生效由列表重新读取确认。
 */
export const actOnDockerContainer = async (
  requestId: string,
  body: DockerContainerActionBody
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.actOnDockerContainer({
      body,
      headers: taskRequestHeaders(requestId),
    })
  )

/** 删除容器：运行中的容器不带 force 会被服务端拒绝（409），不会偷偷加 -f。 */
export const removeDockerContainer = async (
  requestId: string,
  body: DockerContainerDeleteBody
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.removeDockerContainer({
      body,
      headers: taskRequestHeaders(requestId),
    })
  )

/** 新建容器：成功返回 201 与新容器标识；耗时较长时返回 202 受理回执。 */
export const createDockerContainer = async (
  requestId: string,
  body: DockerContainerCreateBody
): Promise<Execution<DockerContainerCreated>> =>
  runExecution<DockerContainerCreated>(() =>
    apiClient.createDockerContainer({
      body,
      headers: taskRequestHeaders(requestId),
    })
  )

/** 拉取镜像：可能很慢，返回 200 完成或 202 受理回执。 */
export const pullDockerImage = async (
  requestId: string,
  body: DockerImagePullBody
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.pullDockerImage({
      body,
      headers: taskRequestHeaders(requestId),
    })
  )

/** 删除镜像：被容器引用且未 force 时服务端返回 409，不会偷偷加 -f。 */
export const removeDockerImage = async (
  requestId: string,
  body: DockerImageDeleteBody
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.removeDockerImage({
      body,
      headers: taskRequestHeaders(requestId),
    })
  )

/** 删除卷：被容器使用时服务端返回 409，不会强行删除。 */
export const removeDockerVolume = async (
  requestId: string,
  body: DockerVolumeDeleteBody
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.removeDockerVolume({
      body,
      headers: taskRequestHeaders(requestId),
    })
  )

/** 删除网络：内置网络与仍有容器接入的网络都会返回 409。 */
export const removeDockerNetwork = async (
  requestId: string,
  body: DockerNetworkDeleteBody
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.removeDockerNetwork({
      body,
      headers: taskRequestHeaders(requestId),
    })
  )

/** Colima 动作：运行中再 start、未运行就 stop 会返回 409。 */
export const actOnDockerColima = async (
  requestId: string,
  body: DockerColimaActionBody
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.actOnDockerColima({
      body,
      headers: taskRequestHeaders(requestId),
    })
  )
