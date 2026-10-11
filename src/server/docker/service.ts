import { cached } from "@server/common/collect"
import type {
  DockerColimaStatus,
  DockerContainer,
  DockerContainerLogsQuery,
  DockerContainerLogsResponse,
  DockerContainersResponse,
  DockerImagesResponse,
  DockerNetworksResponse,
  DockerOverview,
  DockerVolumesResponse,
} from "@shared/api-contract"
import {
  type DockerCache,
  type DockerCli,
  DockerCommandError,
  dockerCli,
} from "./cli"

/**
 * service 只需要 cli 的这几个只读能力；测试可以只实现这些方法。
 * 依赖以参数传入而不是在内部直接引用单例，便于 handler 测试传受控替身。
 */
export type DockerServiceCli = Pick<
  DockerCli,
  | "getColimaStatus"
  | "getInfo"
  | "getDiskUsage"
  | "listContainers"
  | "listImages"
  | "listVolumes"
  | "listNetworks"
  | "getContainerLogs"
  | "inspectContainer"
>

export type DockerService = ReturnType<typeof createDockerService>

/** colima 读取失败时的占位状态：概览仍然要能渲染。 */
const unavailableColima = (
  error: unknown,
  checkedAt: number
): DockerColimaStatus => {
  const notInstalled =
    error instanceof DockerCommandError && error.kind === "not_installed"
  return {
    installed: !notInstalled,
    running: false,
    status: notInstalled ? "未安装 colima" : "colima 状态未知",
    runtime: null,
    arch: null,
    cpus: null,
    memoryBytes: null,
    diskBytes: null,
    checkedAt,
  }
}

/** colima status 単次约 0.7s，给的 TTL 只为挡掉页面轮询带来的重复进程。 */
const COLIMA_TTL = 5_000

const COLIMA_CACHE_KEY = "docker:colima-status"

export const createDockerService = (
  cli: DockerServiceCli = dockerCli,
  /** 测试可传不做缓存的替身，避免用例之间串数据。 */
  cache: DockerCache = cached
) => {
  const readColimaStatus = (): Promise<DockerColimaStatus> =>
    cache(COLIMA_CACHE_KEY, COLIMA_TTL, () => cli.getColimaStatus())

  /**
   * 首屏必须宽容：Colima 未运行或 docker 不可用时返回 available:false 与全 0 计数，
   * 不用错误打断整页；真出问题的原因由 colima 状态与前端提示呈现。
   */
  const getOverview = async (): Promise<DockerOverview> => {
    const checkedAt = Date.now()
    const colima = await readColimaStatus().catch((error: unknown) =>
      unavailableColima(error, checkedAt)
    )
    try {
      const [info, containers, images, volumes, networks, diskUsage] =
        await Promise.all([
          cli.getInfo(),
          cli.listContainers(),
          cli.listImages(),
          cli.listVolumes(),
          cli.listNetworks(),
          cli.getDiskUsage().catch(() => new Map<string, number>()),
        ])
      const running = containers.filter(
        (item) => item.state === "running"
      ).length
      const paused = containers.filter((item) => item.state === "paused").length
      const total = containers.length
      return {
        available: true,
        version: info.serverVersion || null,
        colima,
        containers: {
          total,
          running,
          paused,
          // 除运行与暂停外的都算停止（created/restarting/exited/dead）
          stopped: Math.max(0, total - running - paused),
        },
        images: {
          total: images.length,
          // system df 的 Images 行已去重共享层；读不到时退回各镜像大小之和
          sizeBytes:
            diskUsage.get("Images") ??
            images.reduce((sum, item) => sum + item.sizeBytes, 0),
        },
        volumes: { total: volumes.length },
        networks: { total: networks.length },
        checkedAt,
      }
    } catch {
      return {
        available: false,
        version: null,
        colima,
        containers: { total: 0, running: 0, paused: 0, stopped: 0 },
        images: { total: 0, sizeBytes: 0 },
        volumes: { total: 0 },
        networks: { total: 0 },
        checkedAt,
      }
    }
  }

  const listContainers = async (): Promise<DockerContainersResponse> => ({
    containers: await cli.listContainers(),
    // 被跳过的容器由 cli 的 inspect 降级逻辑内部消化，这里没有需要上报的条目
    skipped: [],
  })

  const listImages = async (): Promise<DockerImagesResponse> => ({
    images: await cli.listImages(),
  })

  const listVolumes = async (): Promise<DockerVolumesResponse> => ({
    volumes: await cli.listVolumes(),
  })

  const listNetworks = async (): Promise<DockerNetworksResponse> => ({
    networks: await cli.listNetworks(),
  })

  const getContainerLogs = (
    query: DockerContainerLogsQuery
  ): Promise<DockerContainerLogsResponse> =>
    cli.getContainerLogs(query.containerId, {
      tail: query.tail,
      since: query.since,
    })

  const getColimaStatus = (): Promise<DockerColimaStatus> => readColimaStatus()

  /** 写操作前的目标核实：读单个容器的真实状态，读不经过列表缓存。 */
  const findContainer = (
    containerId: string
  ): Promise<DockerContainer | null> => cli.inspectContainer(containerId)

  return {
    getOverview,
    listContainers,
    listImages,
    listVolumes,
    listNetworks,
    getContainerLogs,
    getColimaStatus,
    findContainer,
  }
}
