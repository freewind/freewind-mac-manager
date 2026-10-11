import { mkdtempSync, rmSync } from "node:fs"
import type { Server } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { publicSystemError } from "@server/common/public-error"
import { TaskStore } from "@server/common/tasks/store"
import {
  createInlineHost,
  TaskHostError,
} from "@server/common/tasks/worker-host"
import { createTaskRuntime, type TaskRuntime } from "@server/tasks/runtime"
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
  DockerContainerCreatedSchema,
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
import {
  COLIMA_ACTION_KIND,
  type ColimaActionCli,
  runColimaActionTask,
} from "./colima-task"
import { createDockerRouter, dockerContract } from "./handlers"
import { createDockerService, type DockerServiceCli } from "./service"
import { type DockerActionCli, runDockerActionTask } from "./task"

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

/** 读能力 + 写能力 + Colima 能力：任务执行器与 service 共用同一个受控替身。 */
type TestCli = DockerServiceCli & DockerActionCli & ColimaActionCli

const noop = async (): Promise<void> => undefined

const createFakeCli = (overrides: Partial<TestCli> = {}): TestCli => {
  // 镜像存在性是有状态的：拉取后存在、删除后不存在，核实才有意义
  let imagePresent = true
  let volumePresent = true
  let networkPresent = true
  let colimaRunningFlag = true
  return {
    getColimaStatus: async () => ({
      ...colimaRunning,
      running: colimaRunningFlag,
      status: colimaRunningFlag ? "colima 运行中" : "colima 未运行",
    }),
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
    inspectContainer: async (containerId) => container({ id: containerId }),
    imageExists: async () => imagePresent,
    startContainer: noop,
    stopContainer: noop,
    restartContainer: noop,
    killContainer: noop,
    removeContainer: noop,
    createContainer: async () => "created-by-test",
    pullImage: async () => {
      imagePresent = true
    },
    removeImage: async () => {
      imagePresent = false
    },
    removeVolume: async () => {
      volumePresent = false
    },
    volumeExists: async () => volumePresent,
    removeNetwork: async () => {
      networkPresent = false
    },
    networkExists: async () => networkPresent,
    startColima: async () => {
      colimaRunningFlag = true
      return "colima started"
    },
    stopColima: async () => {
      colimaRunningFlag = false
      return "colima stopped"
    },
    ...overrides,
  }
}

const servers: Server[] = []

/** handler 测试一律不做缓存，否则用例之间会串数据。 */
const noCache: DockerCache = (_key, _ttl, load) => load()

const runtimes: { runtime: TaskRuntime; store: TaskStore; dir: string }[] = []

/**
 * 受控运行时：任务真的走 TaskRuntime，但执行器用同一个假 cli，
 * 因此不会发出任何真实 docker 命令。
 */
const startServer = async (
  cli: TestCli,
  options: {
    cache?: DockerCache
    /** 阈值内完成返回 200，否则返回 202 */
    thresholdMs?: number
    /** 任务一直不结束，用来观察冲突判定 */
    hold?: boolean
  } = {}
): Promise<string> => {
  const dir = mkdtempSync(path.join(tmpdir(), "mac-manager-docker-http-"))
  const store = new TaskStore(path.join(dir, "tasks.sqlite3"))
  const host = createInlineHost(async (job, context) => {
    if (options.hold === true) {
      await new Promise<never>(() => undefined)
    }
    try {
      const outcome =
        job.kind === COLIMA_ACTION_KIND
          ? await runColimaActionTask({
              payload: job.payload,
              report: context.onProgress,
              cli,
            })
          : await runDockerActionTask({
              payload: job.payload,
              report: context.onProgress,
              cli,
            })
      return {
        result: outcome.result,
        message: outcome.message,
        status: "done",
      }
    } catch (error) {
      // 与 src/server/task-worker.ts 一致：域内错误转成带 HTTP 状态的宿主错误，
      // 否则测试会看到生产环境不存在的原始文案。
      const failure = publicSystemError(error)
      throw new TaskHostError("failed", failure.body.message, failure.status)
    }
  })
  const runtime = createTaskRuntime({
    store,
    host,
    thresholdMs: options.thresholdMs ?? 1_000,
  })
  runtimes.push({ runtime, store, dir })
  const app = express()
  // 与 app.ts 一致：写端点要能解析 JSON 正文
  app.use(express.json({ limit: "32mb" }))
  createExpressEndpoints(
    dockerContract,
    createDockerRouter(
      createDockerService(cli, options.cache ?? noCache),
      runtime
    ),
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
  for (const item of runtimes.splice(0)) {
    item.runtime.runner.shutdown()
    item.store.close()
    rmSync(item.dir, { recursive: true, force: true })
  }
  await Promise.all(
    servers.splice(0).map((server) => new Promise((r) => server.close(r)))
  )
})

const get = async (baseUrl: string, url: string) => {
  const response = await fetch(`${baseUrl}${url}`)
  return { status: response.status, body: await response.json() }
}

const REQUEST_ID = "req-docker-handler-0001"

/** 写请求：带契约要求的请求标识，重发靠它复用任务。 */
const send = async (
  baseUrl: string,
  url: string,
  method: string,
  body: unknown,
  requestId = REQUEST_ID
) => {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-task-request-id": requestId,
    },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

/** 有状态的受控 cli：动作会真的改状态，核实读到的就是改完之后的状态。 */
const createStatefulCli = (initial: DockerContainer["state"]) => {
  let state: DockerContainer["state"] | "removed" = initial
  const calls: string[] = []
  const cli: TestCli = {
    ...createFakeCli(),
    startContainer: async () => {
      calls.push("startContainer")
      state = "running"
    },
    stopContainer: async () => {
      calls.push("stopContainer")
      state = "exited"
    },
    killContainer: async () => {
      calls.push("killContainer")
      state = "exited"
    },
    restartContainer: async () => {
      calls.push("restartContainer")
      state = "running"
    },
    removeContainer: async () => {
      calls.push("removeContainer")
      state = "removed"
    },
    inspectContainer: async (containerId) =>
      state === "removed"
        ? null
        : container({ id: containerId, state, name: "smoke-target" }),
  }
  return { cli, calls, stateOf: () => state }
}

describe("只读端点", () => {
  it("7 条只读路由都是 GET，两条容器动作分别是 POST 与 DELETE", () => {
    const readRoutes = [
      "getDockerOverview",
      "listDockerContainers",
      "getDockerContainerLogs",
      "listDockerImages",
      "listDockerVolumes",
      "listDockerNetworks",
      "getDockerColimaStatus",
    ] as const
    for (const key of readRoutes) {
      expect(dockerContract[key].method).toBe("GET")
    }
    expect(dockerContract.actOnDockerContainer.method).toBe("POST")
    expect(dockerContract.removeDockerContainer.method).toBe("DELETE")
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
      { cache }
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

describe("容器动作端点", () => {
  it("启动完成后以重新读取到的状态给出 message", async () => {
    const { cli, calls } = createStatefulCli("exited")
    const baseUrl = await startServer(cli)
    const { status, body } = await send(
      baseUrl,
      "/api/docker/containers/action",
      "POST",
      { containerId: "3a2352da7b30", action: "start" }
    )
    expect(status).toBe(200)
    expect(body).toEqual({ message: "已启动 smoke-target" })
    // 命令跑完只是开始：message 来自动作后的 inspect 核实
    expect(calls).toEqual(["startContainer"])
  })

  it("停止与 kill 分别派出不同命令，message 取自核实结果", async () => {
    const stopped = createStatefulCli("running")
    const stoppedUrl = await startServer(stopped.cli)
    const stopResult = await send(
      stoppedUrl,
      "/api/docker/containers/action",
      "POST",
      { containerId: "3a2352da7b30", action: "stop" }
    )
    expect(stopResult.status).toBe(200)
    expect(stopResult.body).toEqual({ message: "已停止 smoke-target" })
    expect(stopped.calls).toEqual(["stopContainer"])

    const killed = createStatefulCli("running")
    const killedUrl = await startServer(killed.cli)
    const killResult = await send(
      killedUrl,
      "/api/docker/containers/action",
      "POST",
      { containerId: "3a2352da7b30", action: "kill" }
    )
    expect(killResult.status).toBe(200)
    expect(killResult.body).toEqual({ message: "已终止 smoke-target" })
    expect(killed.calls).toEqual(["killContainer"])
  })

  it("命令成功但状态没变时如实报失败，不谎报成功", async () => {
    // inspect 永远返回运行中：stop 命令“成功”了，但状态没变
    const cli = createFakeCli({
      stopContainer: async () => undefined,
      inspectContainer: async (containerId) =>
        container({ id: containerId, state: "running", name: "smoke" }),
    })
    const baseUrl = await startServer(cli)
    const { status, body } = await send(
      baseUrl,
      "/api/docker/containers/action",
      "POST",
      { containerId: "3a2352da7b30", action: "stop" }
    )
    expect(status).toBe(500)
    expect(body).toMatchObject({ executionStatus: "failed" })
    expect(JSON.stringify(body)).toContain("仍在运行")
  })

  it("删除运行中的容器且未 force 返回 409，且没有执行 rm", async () => {
    const { cli, calls, stateOf } = createStatefulCli("running")
    const baseUrl = await startServer(cli)
    const { status, body } = await send(
      baseUrl,
      "/api/docker/container",
      "DELETE",
      { containerId: "3a2352da7b30" }
    )
    expect(status).toBe(409)
    expect(body).toEqual({
      message: "容器正在运行，请先停止容器，或显式选择强制删除",
      executionStatus: "not_started",
    })
    // 绝不能偷偷加 -f：rm 没有被执行，容器还在
    expect(calls).toEqual([])
    expect(stateOf()).toBe("running")
  })

  it("显式 force 才允许删除运行中的容器", async () => {
    const { cli, calls, stateOf } = createStatefulCli("running")
    const baseUrl = await startServer(cli)
    const { status, body } = await send(
      baseUrl,
      "/api/docker/container",
      "DELETE",
      { containerId: "3a2352da7b30", force: true }
    )
    expect(status).toBe(200)
    expect(body).toEqual({ message: "已删除 smoke-target" })
    expect(calls).toEqual(["removeContainer"])
    expect(stateOf()).toBe("removed")
  })

  it("容器不存在返回 404", async () => {
    const cli = createFakeCli({ inspectContainer: async () => null })
    const baseUrl = await startServer(cli)
    expect(
      await send(baseUrl, "/api/docker/containers/action", "POST", {
        containerId: "3a2352da7b30",
        action: "start",
      })
    ).toEqual({
      status: 404,
      body: { message: "容器不存在，请重新读取列表" },
    })
    expect(
      await send(baseUrl, "/api/docker/container", "DELETE", {
        containerId: "3a2352da7b30",
      })
    ).toEqual({
      status: 404,
      body: { message: "容器不存在，请重新读取列表" },
    })
  })

  it("载荷非法（契约层校验）返回 400", async () => {
    const baseUrl = await startServer(createFakeCli())
    const { status } = await send(
      baseUrl,
      "/api/docker/containers/action",
      "POST",
      { containerId: "../../etc/passwd", action: "start" }
    )
    expect(status).toBe(400)
    const unknownAction = await send(
      baseUrl,
      "/api/docker/containers/action",
      "POST",
      { containerId: "3a2352da7b30", action: "shellExec" }
    )
    expect(unknownAction.status).toBe(400)
  })

  it("Docker 未运行时返回 500 与可读中文消息", async () => {
    const cli = createFakeCli({
      inspectContainer: async () => {
        throw new DockerCommandError(
          "daemon_unavailable",
          "Docker 服务未运行，请先启动 Docker 或执行 colima start。"
        )
      },
    })
    const baseUrl = await startServer(cli)
    const { status, body } = await send(
      baseUrl,
      "/api/docker/containers/action",
      "POST",
      { containerId: "3a2352da7b30", action: "restart" }
    )
    expect(status).toBe(500)
    // 未执行任何动作，因此不标记 executionStatus
    expect(body).toEqual({ message: "Docker 未运行，请先启动 Colima" })
  })

  it("未完成时返回 202 与受理回执，同容器再次提交返回 409", async () => {
    const { cli } = createStatefulCli("running")
    const baseUrl = await startServer(cli, { hold: true, thresholdMs: 20 })
    const first = await send(
      baseUrl,
      "/api/docker/containers/action",
      "POST",
      { containerId: "3a2352da7b30", action: "restart" },
      REQUEST_ID
    )
    expect(first.status).toBe(202)
    expect(first.body).toMatchObject({
      kind: "docker_action",
      status: "running",
    })

    const again = await send(
      baseUrl,
      "/api/docker/containers/action",
      "POST",
      { containerId: "3a2352da7b30", action: "restart" },
      "req-docker-handler-0002"
    )
    expect(again.status).toBe(409)
    expect(again.body).toMatchObject({ executionStatus: "not_started" })

    // 不同容器不受影响
    const other = await send(
      baseUrl,
      "/api/docker/containers/action",
      "POST",
      { containerId: "d953d207e653", action: "restart" },
      "req-docker-handler-0003"
    )
    expect(other.status).toBe(202)
  })

  it("同容器同 requestId 重发只执行一次", async () => {
    const { cli, calls } = createStatefulCli("exited")
    const baseUrl = await startServer(cli)
    const payload = { containerId: "3a2352da7b30", action: "start" }
    const first = await send(
      baseUrl,
      "/api/docker/containers/action",
      "POST",
      payload,
      REQUEST_ID
    )
    const second = await send(
      baseUrl,
      "/api/docker/containers/action",
      "POST",
      payload,
      REQUEST_ID
    )
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body).toEqual(first.body)
    expect(calls).toEqual(["startContainer"])
  })
})

describe("新建容器端点", () => {
  it("同步完成返回 201 与新容器标识", async () => {
    const created: string[] = []
    const cli = createFakeCli({
      imageExists: async () => true,
      inspectContainer: async (containerId) =>
        // 名字没被占用；新容器创建后是 running
        containerId === "mac-manager-smoke-x"
          ? null
          : container({ id: containerId, name: "smoke-new", state: "running" }),
      createContainer: async () => {
        created.push("createContainer")
        return "new-id-1234567890"
      },
    })
    const baseUrl = await startServer(cli)
    const { status, body } = await send(
      baseUrl,
      "/api/docker/containers",
      "POST",
      { image: "redis:7-alpine", name: "mac-manager-smoke-x" }
    )
    expect(status).toBe(201)
    expect(DockerContainerCreatedSchema.safeParse(body).success).toBe(true)
    expect(body).toEqual({
      containerId: "new-id-1234567890",
      name: "smoke-new",
      message: "已创建并启动 smoke-new",
    })
    expect(created).toEqual(["createContainer"])
  })

  it("本地没有该镜像时返回 409 且不执行 docker run", async () => {
    const created: string[] = []
    const cli = createFakeCli({
      imageExists: async () => false,
      createContainer: async () => {
        created.push("createContainer")
        return "should-not-happen"
      },
    })
    const baseUrl = await startServer(cli)
    const { status, body } = await send(
      baseUrl,
      "/api/docker/containers",
      "POST",
      { image: "redis:7-alpine", name: "mac-manager-smoke-x" }
    )
    expect(status).toBe(409)
    expect(body).toEqual({
      message: "本地没有该镜像，请先在镜像页拉取",
      executionStatus: "not_started",
    })
    // 关键：没有偷偷联网拉取，也没有执行 run
    expect(created).toEqual([])
  })

  it("容器名已被占用返回 409", async () => {
    const cli = createFakeCli({
      imageExists: async () => true,
      inspectContainer: async (containerId) =>
        container({ id: containerId, name: "mac-manager-smoke-x" }),
    })
    const baseUrl = await startServer(cli)
    const { status, body } = await send(
      baseUrl,
      "/api/docker/containers",
      "POST",
      { image: "redis:7-alpine", name: "mac-manager-smoke-x" }
    )
    expect(status).toBe(409)
    expect(body).toEqual({
      message: "容器名 mac-manager-smoke-x 已被占用，请换一个名字",
      executionStatus: "not_started",
    })
  })

  it("未完成时返回 202 受理回执", async () => {
    const cli = createFakeCli()
    const baseUrl = await startServer(cli, { hold: true, thresholdMs: 20 })
    const { status, body } = await send(
      baseUrl,
      "/api/docker/containers",
      "POST",
      { image: "redis:7-alpine" },
      "req-docker-create-0001"
    )
    expect(status).toBe(202)
    expect(body).toMatchObject({ kind: "docker_action", status: "running" })
  })

  it("同 requestId 重发只创建一次", async () => {
    const created: string[] = []
    const cli = createFakeCli({
      inspectContainer: async (containerId) =>
        containerId === "mac-manager-smoke-y"
          ? null
          : container({ id: containerId, name: "smoke-new", state: "running" }),
      createContainer: async () => {
        created.push("createContainer")
        return "new-id-1234567890"
      },
    })
    const baseUrl = await startServer(cli)
    const payload = { image: "redis:7-alpine", name: "mac-manager-smoke-y" }
    const first = await send(
      baseUrl,
      "/api/docker/containers",
      "POST",
      payload,
      "req-docker-create-same"
    )
    const second = await send(
      baseUrl,
      "/api/docker/containers",
      "POST",
      payload,
      "req-docker-create-same"
    )
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(second.body).toEqual(first.body)
    expect(created).toEqual(["createContainer"])
  })

  it("载荷非法返回 400，Docker 未运行返回 500", async () => {
    const baseUrl = await startServer(createFakeCli())
    const illegal = await send(baseUrl, "/api/docker/containers", "POST", {
      image: "--rm",
    })
    expect(illegal.status).toBe(400)

    const broken = createFakeCli({
      imageExists: async () => {
        throw new DockerCommandError(
          "daemon_unavailable",
          "Docker 服务未运行，请先启动 Docker 或执行 colima start。"
        )
      },
    })
    const brokenUrl = await startServer(broken)
    const { status, body } = await send(
      brokenUrl,
      "/api/docker/containers",
      "POST",
      { image: "redis:7-alpine" }
    )
    expect(status).toBe(500)
    expect(body).toEqual({ message: "Docker 未运行，请先启动 Colima" })
  })
})

describe("镜像端点", () => {
  it("拉取完成返回 200", async () => {
    const baseUrl = await startServer(createFakeCli())
    const { status, body } = await send(
      baseUrl,
      "/api/docker/images/pull",
      "POST",
      { image: "alpine:3.20" }
    )
    expect(status).toBe(200)
    expect(body).toEqual({ message: "镜像 alpine:3.20 拉取完成" })
  })

  it("拉取耗时较长返回 202 受理回执", async () => {
    const baseUrl = await startServer(createFakeCli(), {
      hold: true,
      thresholdMs: 20,
    })
    const { status, body } = await send(
      baseUrl,
      "/api/docker/images/pull",
      "POST",
      { image: "alpine:3.20" },
      "req-docker-pull-0001"
    )
    expect(status).toBe(202)
    expect(body).toMatchObject({ kind: "docker_action", status: "running" })
  })

  it("删除镜像成功返回 200", async () => {
    const baseUrl = await startServer(createFakeCli())
    const { status, body } = await send(
      baseUrl,
      "/api/docker/image",
      "DELETE",
      { imageId: "sha256:abc" }
    )
    expect(status).toBe(200)
    expect(body).toEqual({ message: "已删除镜像 sha256:abc" })
  })

  it("被容器引用且未 force 返回 409，且没有加 -f", async () => {
    const calls: unknown[] = []
    const cli = createFakeCli({
      removeImage: async (imageId, options) => {
        calls.push([imageId, options])
        throw new DockerCommandError(
          "conflict",
          "该镜像被容器使用中，请先删除相关容器，或显式选择强制删除"
        )
      },
    })
    const baseUrl = await startServer(cli)
    const { status, body } = await send(
      baseUrl,
      "/api/docker/image",
      "DELETE",
      { imageId: "sha256:abc" }
    )
    expect(status).toBe(409)
    expect(body).toEqual({
      message: "该镜像被容器使用中，请先删除相关容器，或显式选择强制删除",
      executionStatus: "failed",
    })
    // 绝不自作主张强删
    expect(calls).toEqual([["sha256:abc", { force: undefined }]])
  })

  it("载荷非法返回 400", async () => {
    const baseUrl = await startServer(createFakeCli())
    const pull = await send(baseUrl, "/api/docker/images/pull", "POST", {
      image: "--rm",
    })
    expect(pull.status).toBe(400)
    const remove = await send(baseUrl, "/api/docker/image", "DELETE", {
      imageId: "../etc/passwd",
    })
    expect(remove.status).toBe(400)
  })
})

describe("卷与网络删除端点", () => {
  it("删除一次性卷与网络返回 200", async () => {
    const baseUrl = await startServer(createFakeCli())
    const volume = await send(baseUrl, "/api/docker/volume", "DELETE", {
      name: "mac-manager-smoke-vol",
    })
    expect(volume.status).toBe(200)
    expect(volume.body).toEqual({ message: "已删除卷 mac-manager-smoke-vol" })

    const network = await send(
      baseUrl,
      "/api/docker/network",
      "DELETE",
      { networkId: "mac-manager-smoke-net" },
      "req-docker-net-rm-0001"
    )
    expect(network.status).toBe(200)
    expect(network.body).toEqual({
      message: "已删除网络 mac-manager-smoke-net",
    })
  })

  it("被容器使用的卷返回 409，卷仍存在", async () => {
    const cli = createFakeCli({
      removeVolume: async () => {
        throw new DockerCommandError("conflict", "该卷被容器使用中")
      },
    })
    const baseUrl = await startServer(cli)
    const { status, body } = await send(
      baseUrl,
      "/api/docker/volume",
      "DELETE",
      {
        name: "litellm_postgres_data",
      }
    )
    expect(status).toBe(409)
    expect(body).toEqual({
      message: "该卷正被容器使用，请先删除相关容器",
      executionStatus: "failed",
    })
    // 卷没有被删掉
    expect(await cli.volumeExists("litellm_postgres_data")).toBe(true)
  })

  it("删除内置网络返回 409 且不发任何 docker 命令", async () => {
    const sent: string[] = []
    const cli = createFakeCli({
      removeNetwork: async (networkId) => {
        sent.push(networkId)
      },
    })
    const baseUrl = await startServer(cli)
    const { status, body } = await send(
      baseUrl,
      "/api/docker/network",
      "DELETE",
      {
        networkId: "bridge",
      }
    )
    expect(status).toBe(409)
    expect(body).toEqual({
      message: "这是 Docker 内置网络，不能删除",
      executionStatus: "failed",
    })
    expect(sent).toEqual([])
  })

  it("仍有容器接入的网络返回 409", async () => {
    const cli = createFakeCli({
      removeNetwork: async () => {
        throw new DockerCommandError("conflict", "该网络仍有容器接入")
      },
    })
    const baseUrl = await startServer(cli)
    const { status, body } = await send(
      baseUrl,
      "/api/docker/network",
      "DELETE",
      {
        networkId: "litellm_default",
      }
    )
    expect(status).toBe(409)
    expect(body).toEqual({
      message: "该网络仍有容器接入，请先断开",
      executionStatus: "failed",
    })
  })

  it("载荷非法返回 400", async () => {
    const baseUrl = await startServer(createFakeCli())
    expect(
      (await send(baseUrl, "/api/docker/volume", "DELETE", { name: "a b" }))
        .status
    ).toBe(400)
    expect(
      (
        await send(baseUrl, "/api/docker/network", "DELETE", {
          networkId: "../etc/passwd",
        })
      ).status
    ).toBe(400)
  })
})

describe("Colima 动作端点", () => {
  it("未运行时 start 返回 200 与核实后的结果", async () => {
    // 有状态：start 之后状态查询要真的变成运行中，否则核实会失败
    let running = false
    const cli = createFakeCli({
      getColimaStatus: async () => ({
        ...colimaRunning,
        running,
        status: running ? "colima 运行中" : "colima 未运行",
      }),
      startColima: async () => {
        running = true
        return "colima started"
      },
    })
    const baseUrl = await startServer(cli)
    const { status, body } = await send(
      baseUrl,
      "/api/docker/colima/action",
      "POST",
      { action: "start" },
      "req-colima-start-0001"
    )
    expect(status).toBe(200)
    expect(body).toEqual({ message: "Colima 已启动" })
  })

  it("Colima 已在运行时 start 返回 409，不发命令", async () => {
    const started: string[] = []
    const cli = createFakeCli({
      startColima: async () => {
        started.push("startColima")
        return "colima started"
      },
    })
    const baseUrl = await startServer(cli)
    const { status, body } = await send(
      baseUrl,
      "/api/docker/colima/action",
      "POST",
      { action: "start" },
      "req-colima-409-a"
    )
    expect(status).toBe(409)
    expect(body).toEqual({
      message: "Colima 已在运行",
      executionStatus: "not_started",
    })
    expect(started).toEqual([])
  })

  it("Colima 未运行时 stop 返回 409", async () => {
    const cli = createFakeCli({
      getColimaStatus: async () => ({
        ...colimaRunning,
        running: false,
        status: "colima 未运行",
      }),
    })
    const baseUrl = await startServer(cli)
    const { status, body } = await send(
      baseUrl,
      "/api/docker/colima/action",
      "POST",
      { action: "stop" },
      "req-colima-409-b"
    )
    expect(status).toBe(409)
    expect(body).toEqual({
      message: "Colima 未在运行",
      executionStatus: "not_started",
    })
  })

  it("载荷非法返回 400", async () => {
    const baseUrl = await startServer(createFakeCli())
    const { status } = await send(
      baseUrl,
      "/api/docker/colima/action",
      "POST",
      { action: "stop-all" }
    )
    expect(status).toBe(400)
  })

  it("colima 状态读不到时返回 500 与可读中文消息", async () => {
    const cli = createFakeCli({
      getColimaStatus: async () => {
        throw new DockerCommandError(
          "daemon_unavailable",
          "Docker 服务未运行，请先启动 Docker 或执行 colima start。"
        )
      },
    })
    const baseUrl = await startServer(cli)
    const { status, body } = await send(
      baseUrl,
      "/api/docker/colima/action",
      "POST",
      { action: "stop" }
    )
    expect(status).toBe(500)
    expect(body).toEqual({ message: "Docker 未运行，请先启动 Colima" })
  })

  it("未完成时返回 202 受理回执", async () => {
    const baseUrl = await startServer(createFakeCli(), {
      hold: true,
      thresholdMs: 20,
    })
    const { status, body } = await send(
      baseUrl,
      "/api/docker/colima/action",
      "POST",
      { action: "stop" },
      "req-colima-202-0001"
    )
    expect(status).toBe(202)
    expect(body).toMatchObject({ kind: "docker_colima_action" })
  })
})
