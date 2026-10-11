import {
  fetchDockerColimaStatus,
  fetchDockerContainerLogs,
  fetchDockerContainers,
  fetchDockerImages,
  fetchDockerNetworks,
  fetchDockerOverview,
  fetchDockerVolumes,
} from "@shared/client-api"
import { useQuery } from "@tanstack/react-query"

/**
 * 概览轮询间隔：Colima 状态与各项计数都不需要秒级刷新，
 * 每次概览都会真跑一次 colima status，太密会把机器拖慢。
 */
export const DOCKER_OVERVIEW_INTERVAL_MS = 10_000

/** 日志默认只取末尾若干行，避免一次拉回整个容器的历史输出。 */
export const DOCKER_LOG_TAIL_DEFAULT = 200

/** 按域与参数组织查询键：参数必须进 key，避免不同参数共享缓存。 */
export const dockerKeys = {
  overview: ["docker", "overview"] as const,
  colima: ["docker", "colima"] as const,
  containers: ["docker", "containers"] as const,
  images: ["docker", "images"] as const,
  volumes: ["docker", "volumes"] as const,
  networks: ["docker", "networks"] as const,
  logs: (containerId: string, tail: number) =>
    ["docker", "logs", containerId, tail] as const,
}

export const useDockerOverviewQuery = () =>
  useQuery({
    queryKey: dockerKeys.overview,
    queryFn: fetchDockerOverview,
    refetchInterval: DOCKER_OVERVIEW_INTERVAL_MS,
  })

export const useDockerColimaQuery = () =>
  useQuery({
    queryKey: dockerKeys.colima,
    queryFn: fetchDockerColimaStatus,
    refetchInterval: DOCKER_OVERVIEW_INTERVAL_MS,
  })

export const useDockerContainersQuery = () =>
  useQuery({
    queryKey: dockerKeys.containers,
    queryFn: fetchDockerContainers,
  })

export const useDockerImagesQuery = () =>
  useQuery({
    queryKey: dockerKeys.images,
    queryFn: fetchDockerImages,
  })

export const useDockerVolumesQuery = () =>
  useQuery({
    queryKey: dockerKeys.volumes,
    queryFn: fetchDockerVolumes,
  })

export const useDockerNetworksQuery = () =>
  useQuery({
    queryKey: dockerKeys.networks,
    queryFn: fetchDockerNetworks,
  })

/**
 * 日志查询不轮询：日志会一直增长，定时拉取既费机器又难读；
 * 由用户手动重新读取，或由容器列表的变化触发。
 */
export const useDockerContainerLogsQuery = (
  containerId: string,
  tail: number = DOCKER_LOG_TAIL_DEFAULT
) =>
  useQuery({
    queryKey: dockerKeys.logs(containerId, tail),
    queryFn: () => fetchDockerContainerLogs({ containerId, tail }),
    enabled: containerId.length > 0,
    refetchInterval: false,
  })
