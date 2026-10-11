import type { Server } from "node:http"
import type {
  DockerColimaStatus,
  DockerContainer,
  DockerContainerLogsResponse,
  DockerImage,
  DockerNetwork,
  DockerOverview,
  DockerVolume,
} from "@shared/api-contract"
import {
  DockerColimaStatusSchema,
  DockerContainerLogsResponseSchema,
  DockerContainersResponseSchema,
  DockerImagesResponseSchema,
  DockerNetworksResponseSchema,
  DockerOverviewSchema,
  DockerVolumesResponseSchema,
} from "@shared/api-contract/schemas/docker"
import { createExpressEndpoints } from "@ts-rest/express"
import express from "express"
import { afterEach, describe, expect, it } from "vitest"
import { type DockerCache, DockerCommandError } from "./cli"
import { createDockerRouter, dockerContract } from "./handlers"
import { createDockerService, type DockerServiceCli } from "./service"

const colimaRunning: DockerColimaStatus = {
  installed: true,
  running: true,
  status: "colima 运行中",
  runtime: "docker",
  arch: "aarch64",
  cpus: null,
  memoryBytes: null,
  diskBytes: null,
  checkedAt: 1_700_000_000_000,
}

const container = (
  overrides: Partial<DockerContainer> = {}
): DockerContainer => ({
  id: "3a2352da7b309beaaba360ac0799380b586ab098cc7ee70d90d92dfc4ca06f53",
  name: "opendecider",
  image: "opendecider:cpu",
  command: "opendecider serve",
  state: "running",
  status: "Up 34 minutes (healthy)",
  createdAt: 1_700_000_000_000,
  startedAt: 1_700_000_000_500,
  ports: [
    {
      hostIp: "127.0.0.1",
      hostPort: 48000,
      containerPort: 8000,
      protocol: "tcp",
    },
  ],
  mounts: [
    {
      type: "volume",
      source: "/var/lib/docker/volumes/opendecider-models/_data",
      destination: "/models",
      readOnly: false,
    },
  ],
  ...overrides,
})

const containersFixture: DockerContainer[] = [
  container(),
  container({ id: "b".repeat(64), name: "paused-one", state: "paused" }),
  container({ id: "c".repeat(64), name: "exited-one", state: "exited" }),
]

const imagesFixture: DockerImage[] = [
  {
    id: "sha256:abc",
    repository: "opendecider",
    tag: "cpu",
    sizeBytes: 1_750_000_000,
    createdAt: 1_700_000_000_000,
    containers: 1,
  },
  {
    id: "sha256:def",
    repository: "redis",
    tag: "7-alpine",
    sizeBytes: 57_800_000,
    createdAt: 1_700_000_000_000,
    containers: 0,
  },
]

const volumesFixture: DockerVolume[] = [
  {
    name: "opendecider-models",
    driver: "local",
    mountpoint: "/var/lib/docker/volumes/opendecider-models/_data",
    createdAt: 1_700_000_000_000,
    sizeBytes: 795_500_000,
    inUse: true,
  },
]

const networksFixture: DockerNetwork[] = [
  {
    id: "net1",
    name: "bridge",
    driver: "bridge",
    scope: "local",
    internal: false,
    containers: 3,
  },
]

const logsFixture: DockerContainerLogsResponse = {
  containerId: "3a2352da7b30",
  lines: ["hello", "world"],
  truncated: false,
  fetchedAt: 1_700_000_000_000,
}

/** system df 的 Images 行已去重共享层，比逐镜像求和更准。 */
const diskUsageFixture = new Map<string, number>([
  ["Images", 5_100_000_000],
  ["Containers", 96_500_000],
  ["Local Volumes", 865_200_000],
])

const createFakeCli = (
  overrides: Partial<DockerServiceCli> = {}
): DockerServiceCli => ({
  getColimaStatus: async () => colimaRunning,
  getInfo: async () => ({
    serverVersion: "29.5.2",
    containersTotal: 3,
    containersRunning: 1,
    containersPaused: 1,
    containersStopped: 1,
    imagesTotal: 2,
  }),
  getDiskUsage: async () => diskUsageFixture,
  listContainers: async () => containersFixture,
  listImages: async () => imagesFixture,
  listVolumes: async () => volumesFixture,
  listNetworks: async () => networksFixture,
  getContainerLogs: async (containerId) => ({ ...logsFixture, containerId }),
  ...overrides,
})

const servers: Server[] = []

/** handler 测试一律不做缓存，否则用例之间会串数据。 */
const noCache: DockerCache = (_key, _ttl, load) => load()

const startServer = async (
  cli: DockerServiceCli,
  cache: DockerCache = noCache
): Promise<string> => {
  const app = express()
  createExpressEndpoints(
    dockerContract,
    createDockerRouter(createDockerService(cli, cache)),
    app,
    { logInitialization: false }
  )
  const server = app.listen(0)
  servers.push(server)
  await new Promise((resolve) => server.once("listening", resolve))
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  return `http://127.0.0.1:${port}`
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((r) => server.close(r)))
  )
})

const get = async (baseUrl: string, url: string) => {
  const response = await fetch(`${baseUrl}${url}`)
  return { status: response.status, body: await response.json() }
}

describe("只读端点", () => {
  it("只暴露 7 条 GET 路由，没有写操作", () => {
    expect(Object.keys(dockerContract)).toMatchInlineSnapshot(`
      [
        "getDockerOverview",
        "listDockerContainers",
        "getDockerContainerLogs",
        "listDockerImages",
        "listDockerVolumes",
        "listDockerNetworks",
        "getDockerColimaStatus",
      ]
    `)
    for (const route of Object.values(dockerContract)) {
      expect(route.method).toBe("GET")
    }
  })

  it("概览返回契约结构，计数与磁盘占用取真实来源", async () => {
    const baseUrl = await startServer(createFakeCli())
    const { status, body } = await get(baseUrl, "/api/docker/overview")
    expect(status).toBe(200)
    const parsed = DockerOverviewSchema.safeParse(body)
    expect(parsed.success).toBe(true)
    expect(body).toMatchObject({
      available: true,
      version: "29.5.2",
      colima: { installed: true, running: true },
      containers: { total: 3, running: 1, paused: 1, stopped: 1 },
      images: { total: 2, sizeBytes: 5_100_000_000 },
      volumes: { total: 1 },
      networks: { total: 1 },
    })
  })

  it("读不到 system df 时镜像占用退回各镜像大小之和", async () => {
    const baseUrl = await startServer(
      createFakeCli({ getDiskUsage: async () => new Map() })
    )
    const { body } = await get(baseUrl, "/api/docker/overview")
    expect((body as DockerOverview).images).toEqual({
      total: 2,
      sizeBytes: 1_750_000_000 + 57_800_000,
    })
  })

  it("容器列表返回契约结构且带 skipped", async () => {
    const baseUrl = await startServer(createFakeCli())
    const { status, body } = await get(baseUrl, "/api/docker/containers")
    expect(status).toBe(200)
    expect(DockerContainersResponseSchema.safeParse(body).success).toBe(true)
    expect((body as { skipped: unknown[] }).skipped).toEqual([])
    const containers = (body as { containers: DockerContainer[] }).containers
    expect(containers).toHaveLength(3)
    expect(containers[0]).toMatchObject({
      name: "opendecider",
      state: "running",
      status: "Up 34 minutes (healthy)",
    })
  })

  it("镜像、卷、网络、colima 状态各自返回契约结构", async () => {
    const baseUrl = await startServer(createFakeCli())
    const images = await get(baseUrl, "/api/docker/images")
    expect(images.status).toBe(200)
    expect(DockerImagesResponseSchema.safeParse(images.body).success).toBe(true)

    const volumes = await get(baseUrl, "/api/docker/volumes")
    expect(volumes.status).toBe(200)
    expect(DockerVolumesResponseSchema.safeParse(volumes.body).success).toBe(
      true
    )

    const networks = await get(baseUrl, "/api/docker/networks")
    expect(networks.status).toBe(200)
    expect(DockerNetworksResponseSchema.safeParse(networks.body).success).toBe(
      true
    )

    const colima = await get(baseUrl, "/api/docker/colima")
    expect(colima.status).toBe(200)
    expect(DockerColimaStatusSchema.safeParse(colima.body).success).toBe(true)
    expect(colima.body).toMatchObject({ installed: true, running: true })
  })

  it("日志端点返回契约结构，并把 tail/since 透传给 cli", async () => {
    const received: { containerId: string; tail?: number; since?: number }[] =
      []
    const baseUrl = await startServer(
      createFakeCli({
        getContainerLogs: async (containerId, options) => {
          received.push({ containerId, ...options })
          return { ...logsFixture, containerId }
        },
      })
    )
    const { status, body } = await get(
      baseUrl,
      "/api/docker/containers/logs?containerId=1a2b3c4d5e6f&tail=50&since=1700"
    )
    expect(status).toBe(200)
    expect(DockerContainerLogsResponseSchema.safeParse(body).success).toBe(true)
    expect(received).toEqual([
      { containerId: "1a2b3c4d5e6f", tail: 50, since: 1700 },
    ])
  })
})

describe("概览的宽容返回", () => {
  it("docker 未运行时仍返回 200，available 与 running 为 false 且计数为 0", async () => {
    const baseUrl = await startServer(
      createFakeCli({
        getInfo: async () => {
          throw new DockerCommandError(
            "daemon_unavailable",
            "Docker 服务未运行，请先启动 Docker 或执行 colima start。"
          )
        },
      })
    )
    const { status, body } = await get(baseUrl, "/api/docker/overview")
    expect(status).toBe(200)
    expect(DockerOverviewSchema.safeParse(body).success).toBe(true)
    expect(body).toMatchObject({
      available: false,
      version: null,
      colima: { running: true },
      containers: { total: 0, running: 0, paused: 0, stopped: 0 },
      images: { total: 0, sizeBytes: 0 },
      volumes: { total: 0 },
      networks: { total: 0 },
    })
  })

  it("colima 未安装时概览仍可用，只标记 colima 不可用", async () => {
    const baseUrl = await startServer(
      createFakeCli({
        getColimaStatus: async () => {
          throw new DockerCommandError(
            "not_installed",
            "未找到 colima 命令，请先安装 Colima。"
          )
        },
      })
    )
    const { status, body } = await get(baseUrl, "/api/docker/overview")
    expect(status).toBe(200)
    expect(body).toMatchObject({
      available: true,
      colima: { installed: false, running: false, status: "未安装 colima" },
    })
  })
  it("colima 状态在 5 秒 TTL 内复用缓存", async () => {
    let calls = 0
    const seen: { key: string; ttl: number }[] = []
    const store = new Map<string, unknown>()
    const cache: DockerCache = async (key, ttl, load) => {
      seen.push({ key, ttl })
      if (store.has(key)) return store.get(key) as never
      const value = await load()
      store.set(key, value)
      return value
    }
    const baseUrl = await startServer(
      createFakeCli({
        getColimaStatus: async () => {
          calls += 1
          return colimaRunning
        },
      }),
      cache
    )
    await get(baseUrl, "/api/docker/colima")
    await get(baseUrl, "/api/docker/colima")
    await get(baseUrl, "/api/docker/overview")
    // 三次请求（含概览）只起一次 colima 进程
    expect(calls).toBe(1)
    expect(seen).toEqual([
      { key: "docker:colima-status", ttl: 5_000 },
      { key: "docker:colima-status", ttl: 5_000 },
      { key: "docker:colima-status", ttl: 5_000 },
    ])
  })
})

describe("错误映射", () => {
  it("容器不存在返回 404", async () => {
    const baseUrl = await startServer(
      createFakeCli({
        getContainerLogs: async () => {
          throw new DockerCommandError(
            "failed",
            "docker 命令执行失败：Error: No such container: 1a2b",
            "Error: No such container: 1a2b"
          )
        },
      })
    )
    const { status, body } = await get(
      baseUrl,
      "/api/docker/containers/logs?containerId=1a2b3c4d5e6f"
    )
    expect(status).toBe(404)
    expect(body).toEqual({ message: "容器不存在，请重新读取列表" })
  })

  it("容器标识非法返回 400", async () => {
    const baseUrl = await startServer(
      createFakeCli({
        getContainerLogs: async () => {
          throw new DockerCommandError(
            "invalid_input",
            "容器标识包含非法字符，请重新读取容器列表。"
          )
        },
      })
    )
    const { status, body } = await get(
      baseUrl,
      "/api/docker/containers/logs?containerId=1a2b"
    )
    expect(status).toBe(400)
    expect(body).toEqual({ message: "容器标识不合法，请重新读取列表" })
  })

  it("docker 未安装时列表端点返回 500 与中文消息", async () => {
    const baseUrl = await startServer(
      createFakeCli({
        listImages: async () => {
          throw new DockerCommandError(
            "not_installed",
            "未找到 docker 命令，请确认 Docker 或 Colima 已安装。"
          )
        },
      })
    )
    const { status, body } = await get(baseUrl, "/api/docker/images")
    expect(status).toBe(500)
    expect(body).toEqual({ message: "未安装 Docker 或 Colima，请先安装" })
  })

  it("daemon 未运行时列表端点返回 500 与可读中文消息", async () => {
    const baseUrl = await startServer(
      createFakeCli({
        listContainers: async () => {
          throw new DockerCommandError(
            "daemon_unavailable",
            "Docker 服务未运行，请先启动 Docker 或执行 colima start。"
          )
        },
      })
    )
    const { status, body } = await get(baseUrl, "/api/docker/containers")
    expect(status).toBe(500)
    expect(body).toEqual({ message: "Docker 未运行，请先启动 Colima" })
  })

  it("超时与未知异常都收敛成 500，且不带内部细节", async () => {
    const timeoutUrl = await startServer(
      createFakeCli({
        listVolumes: async () => {
          throw new DockerCommandError("timeout", "docker 命令执行超时。")
        },
      })
    )
    expect(await get(timeoutUrl, "/api/docker/volumes")).toEqual({
      status: 500,
      body: { message: "Docker 命令执行超时，请稍后重试" },
    })

    const brokenUrl = await startServer(
      createFakeCli({
        listNetworks: async () => {
          throw new Error("sensitive-token /private/internal/path")
        },
      })
    )
    const broken = await get(brokenUrl, "/api/docker/networks")
    expect(broken.status).toBe(500)
    expect(JSON.stringify(broken.body)).not.toContain("sensitive-token")
    expect(broken.body).toEqual({
      message: "操作未能完成，请重新读取目标核实",
    })
  })
})
