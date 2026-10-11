import { ApiPath, toContractPath } from "@shared/api-path"
import {
  ActionResponseSchema,
  ApiErrorSchema,
  TaskAcceptedSchema,
  TaskRequestIdHeadersSchema,
} from "../schemas/common"
import {
  DockerColimaActionBodySchema,
  DockerColimaStatusSchema,
  DockerContainerActionBodySchema,
  DockerContainerCreateBodySchema,
  DockerContainerCreatedSchema,
  DockerContainerDeleteBodySchema,
  DockerContainerLogsQuerySchema,
  DockerContainerLogsResponseSchema,
  DockerContainersResponseSchema,
  DockerImageDeleteBodySchema,
  DockerImagePullBodySchema,
  DockerImagesResponseSchema,
  DockerNetworkDeleteBodySchema,
  DockerNetworksResponseSchema,
  DockerOverviewSchema,
  DockerVolumeDeleteBodySchema,
  DockerVolumesResponseSchema,
} from "../schemas/docker"

const errorResponses = {
  400: ApiErrorSchema,
  403: ApiErrorSchema,
  404: ApiErrorSchema,
  500: ApiErrorSchema,
} as const

/**
 * 写操作一律接受请求标识：服务端据此复用任务，重发不会变成第二次执行。
 * 阈值内完成返回 200 与结果，超过阈值返回 202 与任务标识，冲突返回 409。
 */
const actionResponses = {
  200: ActionResponseSchema,
  202: TaskAcceptedSchema,
  409: ApiErrorSchema,
  ...errorResponses,
} as const

export const dockerRoutes = {
  // ---- 只读：GET + 200 ----
  getDockerOverview: {
    method: "GET",
    path: toContractPath(ApiPath.dockerOverview),
    responses: { 200: DockerOverviewSchema, ...errorResponses },
  },
  listDockerContainers: {
    method: "GET",
    path: toContractPath(ApiPath.dockerContainers),
    responses: { 200: DockerContainersResponseSchema, ...errorResponses },
  },
  getDockerContainerLogs: {
    method: "GET",
    path: toContractPath(ApiPath.dockerContainersLogs),
    query: DockerContainerLogsQuerySchema,
    responses: { 200: DockerContainerLogsResponseSchema, ...errorResponses },
  },
  listDockerImages: {
    method: "GET",
    path: toContractPath(ApiPath.dockerImages),
    responses: { 200: DockerImagesResponseSchema, ...errorResponses },
  },
  listDockerVolumes: {
    method: "GET",
    path: toContractPath(ApiPath.dockerVolumes),
    responses: { 200: DockerVolumesResponseSchema, ...errorResponses },
  },
  listDockerNetworks: {
    method: "GET",
    path: toContractPath(ApiPath.dockerNetworks),
    responses: { 200: DockerNetworksResponseSchema, ...errorResponses },
  },
  getDockerColimaStatus: {
    method: "GET",
    path: toContractPath(ApiPath.dockerColima),
    responses: { 200: DockerColimaStatusSchema, ...errorResponses },
  },
  // ---- 写操作：带请求标识 + 202 + 409 ----
  // 新建容器与镜像拉取都可能很慢，因此既可能同步完成也可能转为后台任务。
  // 新建容器：资源已创建返回 201 与新容器标识；耗时较长时返回 202 与任务标识。
  createDockerContainer: {
    method: "POST",
    path: toContractPath(ApiPath.dockerContainers),
    body: DockerContainerCreateBodySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: {
      201: DockerContainerCreatedSchema,
      202: TaskAcceptedSchema,
      409: ApiErrorSchema,
      ...errorResponses,
    },
  },
  // start/stop/restart 是对既有容器执行的动作，用 POST。
  actOnDockerContainer: {
    method: "POST",
    path: toContractPath(ApiPath.dockerContainersAction),
    body: DockerContainerActionBodySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: actionResponses,
  },
  removeDockerContainer: {
    method: "DELETE",
    path: toContractPath(ApiPath.dockerContainer),
    body: DockerContainerDeleteBodySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: actionResponses,
  },
  pullDockerImage: {
    method: "POST",
    path: toContractPath(ApiPath.dockerImagesPull),
    body: DockerImagePullBodySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: actionResponses,
  },
  removeDockerImage: {
    method: "DELETE",
    path: toContractPath(ApiPath.dockerImage),
    body: DockerImageDeleteBodySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: actionResponses,
  },
  removeDockerVolume: {
    method: "DELETE",
    path: toContractPath(ApiPath.dockerVolume),
    body: DockerVolumeDeleteBodySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: actionResponses,
  },
  removeDockerNetwork: {
    method: "DELETE",
    path: toContractPath(ApiPath.dockerNetwork),
    body: DockerNetworkDeleteBodySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: actionResponses,
  },
  actOnDockerColima: {
    method: "POST",
    path: toContractPath(ApiPath.dockerColimaAction),
    body: DockerColimaActionBodySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: actionResponses,
  },
} as const
