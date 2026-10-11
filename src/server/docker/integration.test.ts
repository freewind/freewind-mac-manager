import { mkdtempSync, rmSync } from "node:fs"
import type { Server } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { createApp } from "@server/app"
import { publicSystemError } from "@server/common/public-error"
import { TaskStore } from "@server/common/tasks/store"
import {
  createInlineHost,
  TaskHostError,
} from "@server/common/tasks/worker-host"
import { DockerCommandError } from "@server/docker/cli"
import { runColimaActionTask } from "@server/docker/colima-task"
import { runDockerActionTask } from "@server/docker/task"
import { createTaskRuntime, type TaskRuntime } from "@server/tasks/runtime"
import type {
  DockerColimaStatus,
  DockerContainer,
  DockerImage,
  DockerNetwork,
  DockerVolume,
} from "@shared/api-contract"
import { TASK_REQUEST_ID_HEADER } from "@shared/api-contract"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

/**
 * Docker 域的全链集成测试：走真实的 createApp（真实契约、handler 与任务运行时），
 * 只把 Docker 执行层换成受控替身——既不碰真实 docker，也不碰真实数据库。
 *
 * 覆盖：概览 → 容器列表 → 容器动作 → 新建容器 → 镜像拉取/删除 → 卷/网络删除 → Colima 动作，
 * 以及幂等、同目标冲突、危险动作的后端校验与错误语义。
 */

type Container = DockerContainer
type State = {
  containers: Map<string, Container>
  images: Map<string, DockerImage>
  volumes: Map<string, DockerVolume>
  networks: Map<string, DockerNetwork>
  colimaRunning: boolean
  /** 每个写方法被调用的次数，用来验证幂等（重发不该再执行一次） */
  calls: string[]
  nextId: number
  /** 让任务一直不结束：用来观察同目标冲突 */
  hold: boolean
  /** 让任务延迟这么久再执行：用来模拟「受理后才完成」的长任务 */
  holdMs: number
}

const newState = (): State => ({
  containers: new Map(),
  images: new Map(),
  volumes: new Map(),
  networks: new Map(),
  colimaRunning: true,
  calls: [],
  nextId: 1,
  hold: false,
  holdMs: 0,
})

const containerOf = (
  id: string,
  name: string,
  state: Container["state"] = "running"
): Container => ({
  id,
  name,
  image: "redis:7-alpine",
  command: "redis-server",
  state,
  status: state === "running" ? "Up 1 minute" : "Exited (0)",
  createdAt: 1_790_000_000_000,
  startedAt: state === "running" ? 1_790_000_000_500 : null,
  ports: [],
  mounts: [],
})

const colimaStatus = (running: boolean): DockerColimaStatus => ({
  installed: true,
  running,
  status: running ? "colima 运行中" : "colima 未运行",
  runtime: "docker",
  arch: "x86_64",
  cpus: null,
  memoryBytes: null,
  diskBytes: null,
  checkedAt: 1_790_000_000_000,
})

/** 受控 Docker 执行层：所有动作改的是内存里的状态，不执行任何真实命令。 */
const createFakeCli = (state: State) => {
  const inUseVolume = (name: string): boolean =>
    Array.from(state.containers.values()).some((container) =>
      container.mounts.some(
        (mount) => mount.type === "volume" && mount.source.includes(name)
      )
    )

  return {
    // ---- 只读 ----
    getColimaStatus: async () => colimaStatus(state.colimaRunning),
    getInfo: async () => ({
      serverVersion: "29.5.2",
      containersTotal: state.containers.size,
      containersRunning: Array.from(state.containers.values()).filter(
        (item) => item.state === "running"
      ).length,
      containersPaused: 0,
      containersStopped: 0,
      imagesTotal: state.images.size,
    }),
    getDiskUsage: async () => new Map<string, number>([["Images", 12_200_000]]),
    listContainers: async () => Array.from(state.containers.values()),
    listImages: async () => Array.from(state.images.values()),
    listVolumes: async () =>
      Array.from(state.volumes.values()).map((volume) => ({
        ...volume,
        inUse: inUseVolume(volume.name),
      })),
    listNetworks: async () => Array.from(state.networks.values()),
    getContainerLogs: async (containerId: string) => ({
      containerId,
      lines: ["ready", "listening"],
      truncated: false,
      fetchedAt: 1_790_000_000_000,
    }),
    inspectContainer: async (containerId: string) =>
      state.containers.get(containerId) ??
      Array.from(state.containers.values()).find(
        (item) => item.name === containerId
      ) ??
      null,
    imageExists: async (image: string) => state.images.has(image),

    // ---- 写 ----
    startContainer: async (containerId: string) => {
      state.calls.push(`start:${containerId}`)
      const found = state.containers.get(containerId)
      if (found) found.state = "running"
    },
    stopContainer: async (containerId: string) => {
      state.calls.push(`stop:${containerId}`)
      const found = state.containers.get(containerId)
      if (found) found.state = "exited"
    },
    restartContainer: async (containerId: string) => {
      state.calls.push(`restart:${containerId}`)
      const found = state.containers.get(containerId)
      if (found) found.state = "running"
    },
    killContainer: async (containerId: string) => {
      state.calls.push(`kill:${containerId}`)
      const found = state.containers.get(containerId)
      if (found) found.state = "exited"
    },
    removeContainer: async (containerId: string) => {
      state.calls.push(`remove:${containerId}`)
      state.containers.delete(containerId)
    },
    createContainer: async (config: { image: string; name?: string }) => {
      const id = `created-${state.nextId}`
      state.nextId += 1
      state.calls.push(`create:${id}`)
      state.containers.set(id, {
        ...containerOf(id, config.name ?? `auto-${id}`),
        image: config.image,
      })
      return id
    },
    pullImage: async (image: string) => {
      state.calls.push(`pull:${image}`)
      state.images.set(image, {
        id: `sha256:${image}`,
        repository: image.split(":")[0] ?? image,
        tag: image.split(":")[1] ?? "latest",
        sizeBytes: 12_200_000,
        createdAt: 1_790_000_000_000,
        containers: 0,
      })
    },
    removeImage: async (imageId: string) => {
      state.calls.push(`removeImage:${imageId}`)
      const using = Array.from(state.containers.values()).filter(
        (item) => item.image === imageId
      )
      if (using.length > 0) {
        throw new DockerCommandError("conflict", "该镜像被容器使用中", "")
      }
      state.images.delete(imageId)
    },
    removeVolume: async (name: string) => {
      state.calls.push(`removeVolume:${name}`)
      if (inUseVolume(name)) {
        throw new DockerCommandError("conflict", "该卷被容器使用中", "")
      }
      state.volumes.delete(name)
    },
    volumeExists: async (name: string) => state.volumes.has(name),
    removeNetwork: async (networkId: string) => {
      state.calls.push(`removeNetwork:${networkId}`)
      const network = state.networks.get(networkId)
      if (network?.builtin) {
        throw new DockerCommandError(
          "conflict",
          "这是 Docker 内置网络，不能删除",
          ""
        )
      }
      if ((network?.containers ?? 0) > 0) {
        throw new DockerCommandError("conflict", "该网络仍有容器接入", "")
      }
      state.networks.delete(networkId)
    },
    networkExists: async (networkId: string) => state.networks.has(networkId),
    startColima: async () => {
      state.calls.push("startColima")
      state.colimaRunning = true
      return "colima started"
    },
    stopColima: async () => {
      state.calls.push("stopColima")
      state.colimaRunning = false
      return "colima stopped"
    },
  }
}

const BUILTIN_NETWORKS = ["bridge", "host", "none"]

/** 从响应里取出指定 cookie 的 name=value 片段。 */
const cookieOf = (response: Response, name: string): string => {
  const found = response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${name}=`))
  expect(found, `缺少 cookie ${name}`).toBeTruthy()
  return (found ?? "").split(";")[0] ?? ""
}

const csrfCookieOf = (response: Response): string =>
  cookieOf(response, "mac_manager_csrf")

const sessionCookieOf = (response: Response): string =>
  cookieOf(response, "mac_manager_session")

let dir: string
let store: TaskStore
let runtime: TaskRuntime
let server: Server
let baseUrl: string
let state: State

/** 应用要求登录（鉴权是既有能力），集成测试也走真实的登录流程。 */
const TEST_PASSWORD = "integration-password-1234"
let cookieHeader = ""
let csrfToken = ""

const send = async (
  method: string,
  url: string,
  options: { body?: unknown; requestId?: string } = {}
) => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  }
  if (cookieHeader) headers.cookie = cookieHeader
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    headers["x-csrf-token"] = csrfToken
  }
  if (options.requestId) headers[TASK_REQUEST_ID_HEADER] = options.requestId
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  })
  const text = await response.text()
  return {
    status: response.status,
    body: text.length > 0 ? JSON.parse(text) : null,
  }
}

beforeEach(async () => {
  // createAuthManager 在应用创建时读密码：这里先注入，测试结束后恢复
  process.env.MAC_MANAGER_PASSWORD = TEST_PASSWORD
  state = newState()
  state.containers.set("c1", containerOf("c1", "smoke-web"))
  state.containers.set("c2", containerOf("c2", "smoke-idle", "exited"))
  state.images.set("redis:7-alpine", {
    id: "sha256:redis",
    repository: "redis",
    tag: "7-alpine",
    sizeBytes: 41_000_000,
    createdAt: 1_790_000_000_000,
    containers: 2,
  })
  state.volumes.set("smoke-vol", {
    name: "smoke-vol",
    driver: "local",
    mountpoint: "/var/lib/docker/volumes/smoke-vol/_data",
    createdAt: 1_790_000_000_000,
    sizeBytes: 1024,
    inUse: false,
  })
  for (const name of [...BUILTIN_NETWORKS, "smoke-net"]) {
    state.networks.set(name, {
      id: `id-${name}`,
      name,
      driver: "bridge",
      scope: "local",
      internal: false,
      containers: name === "smoke-net" ? 0 : 1,
      builtin: BUILTIN_NETWORKS.includes(name),
    })
  }

  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-docker-http-"))
  store = new TaskStore(path.join(dir, "tasks.sqlite3"))
  const cli = createFakeCli(state)
  const host = createInlineHost(async (job, context) => {
    if (state.hold) {
      // 任务一直不结束：用来观察同目标冲突
      await new Promise<never>(() => undefined)
    }
    if (state.holdMs > 0) {
      // 模拟长任务：先返回受理回执，过一会儿才真正执行
      await new Promise((resolve) => setTimeout(resolve, state.holdMs))
    }
    try {
      const outcome =
        job.kind === "docker_colima_action"
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
        status: "done" as const,
      }
    } catch (error) {
      // 与 src/server/task-worker.ts 一致：域内错误转成带 HTTP 状态的宿主错误，
      // 否则冲突（如镜像被引用）会退化成 500
      const failure = publicSystemError(error)
      throw new TaskHostError("failed", failure.body.message, failure.status)
    }
  })
  runtime = createTaskRuntime({ store, host, thresholdMs: 20 })
  const app = createApp({
    tasks: runtime,
    initializeBusiness: false,
    dockerCli: cli,
  })
  server = app.listen(0)
  await new Promise((resolve) => server.once("listening", resolve))
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  baseUrl = `http://127.0.0.1:${port}`

  // 真实登录：csrf → login，把两个 cookie 都带上
  const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`)
  const csrfBody = (await csrfResponse.json()) as { csrfToken: string }
  csrfToken = csrfBody.csrfToken
  const csrfCookie = csrfCookieOf(csrfResponse)
  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": csrfToken,
      cookie: csrfCookie,
    },
    body: JSON.stringify({ password: TEST_PASSWORD }),
  })
  expect(loginResponse.status).toBe(200)
  cookieHeader = `${csrfCookie}; ${sessionCookieOf(loginResponse)}`
})

afterEach(async () => {
  delete process.env.MAC_MANAGER_PASSWORD
  runtime.runner.shutdown()
  store.close()
  rmSync(dir, { recursive: true, force: true })
  await new Promise((resolve) => server.close(resolve))
})

describe("Docker 域全链路", () => {
  it("概览与三类列表都从真实执行层读取", async () => {
    const overview = await send("GET", "/api/docker/overview")
    expect(overview.status).toBe(200)
    expect(overview.body).toMatchObject({
      available: true,
      containers: { total: 2, running: 1, paused: 0, stopped: 1 },
      images: { total: 1, sizeBytes: 12_200_000 },
      volumes: { total: 1 },
      networks: { total: 4 },
    })

    const containers = await send("GET", "/api/docker/containers")
    expect(containers.status).toBe(200)
    expect(
      (containers.body as { containers: Container[] }).containers.map(
        (item) => item.name
      )
    ).toEqual(["smoke-web", "smoke-idle"])

    const images = await send("GET", "/api/docker/images")
    expect(images.status).toBe(200)
    expect((images.body as { images: DockerImage[] }).images).toHaveLength(1)

    const volumes = await send("GET", "/api/docker/volumes")
    expect(volumes.status).toBe(200)
    expect((volumes.body as { volumes: DockerVolume[] }).volumes[0]?.name).toBe(
      "smoke-vol"
    )

    const networks = await send("GET", "/api/docker/networks")
    expect(networks.status).toBe(200)
    // 内置网络由契约字段标记，前端据此禁用删除按钮
    expect(
      (networks.body as { networks: DockerNetwork[] }).networks.map((item) => [
        item.name,
        item.builtin,
      ])
    ).toEqual([
      ["bridge", true],
      ["host", true],
      ["none", true],
      ["smoke-net", false],
    ])
  })

  it("容器动作走到执行层并以真实状态给出 message", async () => {
    const stop = await send("POST", "/api/docker/containers/action", {
      body: { containerId: "c1", action: "stop" },
      requestId: "req-int-stop-0001",
    })
    expect(stop.status).toBe(200)
    expect(stop.body).toEqual({ message: "已停止 smoke-web" })
    expect(state.containers.get("c1")?.state).toBe("exited")

    const start = await send("POST", "/api/docker/containers/action", {
      body: { containerId: "c1", action: "start" },
      requestId: "req-int-start-0001",
    })
    expect(start.body).toEqual({ message: "已启动 smoke-web" })

    const kill = await send("POST", "/api/docker/containers/action", {
      body: { containerId: "c1", action: "kill" },
      requestId: "req-int-kill-0001",
    })
    expect(kill.body).toEqual({ message: "已终止 smoke-web" })

    // 容器不存在：提交前就查实
    const missing = await send("POST", "/api/docker/containers/action", {
      body: { containerId: "not-there", action: "start" },
      requestId: "req-int-missing-0001",
    })
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ message: "容器不存在，请重新读取列表" })
  })

  it("同 requestId 重发只执行一次；同容器并发提交返回 409", async () => {
    const payload = { containerId: "c2", action: "start" }
    const first = await send("POST", "/api/docker/containers/action", {
      body: payload,
      requestId: "req-int-idem-0001",
    })
    const second = await send("POST", "/api/docker/containers/action", {
      body: payload,
      requestId: "req-int-idem-0001",
    })
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(
      state.calls.filter((call) => call.startsWith("start:c2"))
    ).toHaveLength(1)

    // 任务不结束：同目标第二次提交会被运行时判为冲突
    state.hold = true
    const held = await send("POST", "/api/docker/containers/action", {
      body: { containerId: "c1", action: "restart" },
      requestId: "req-int-hold-0001",
    })
    expect(held.status).toBe(202)
    const conflicted = await send("POST", "/api/docker/containers/action", {
      body: { containerId: "c1", action: "restart" },
      requestId: "req-int-hold-0002",
    })
    expect(conflicted.status).toBe(409)
    expect(conflicted.body).toMatchObject({ executionStatus: "not_started" })
    state.hold = false
  })

  it("新建容器返回 201 与新容器标识；本地无镜像或名称占用返回 409", async () => {
    const created = await send("POST", "/api/docker/containers", {
      body: { image: "redis:7-alpine", name: "smoke-new" },
      requestId: "req-int-create-0001",
    })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      name: "smoke-new",
      message: "已创建并启动 smoke-new",
    })
    expect(String(created.body.containerId)).toMatch(/^created-\d+$/)

    const missingImage = await send("POST", "/api/docker/containers", {
      body: { image: "not-local:latest" },
      requestId: "req-int-create-0002",
    })
    expect(missingImage.status).toBe(409)
    expect(missingImage.body).toEqual({
      message: "本地没有该镜像，请先在镜像页拉取",
      executionStatus: "not_started",
    })

    const duplicate = await send("POST", "/api/docker/containers", {
      body: { image: "redis:7-alpine", name: "smoke-web" },
      requestId: "req-int-create-0003",
    })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body).toMatchObject({
      message: "容器名 smoke-web 已被占用，请换一个名字",
    })
  })

  it("镜像拉取与删除：被容器引用时 409，未被引用时删除成功", async () => {
    const pull = await send("POST", "/api/docker/images/pull", {
      body: { image: "alpine:3.20" },
      requestId: "req-int-pull-0001",
    })
    expect(pull.status).toBe(200)
    expect(pull.body).toEqual({ message: "镜像 alpine:3.20 拉取完成" })

    const remove = await send("DELETE", "/api/docker/image", {
      body: { imageId: "alpine:3.20" },
      requestId: "req-int-image-0001",
    })
    expect(remove.status).toBe(200)
    expect(remove.body).toEqual({ message: "已删除镜像 alpine:3.20" })

    const referenced = await send("DELETE", "/api/docker/image", {
      body: { imageId: "redis:7-alpine" },
      requestId: "req-int-image-0002",
    })
    expect(referenced.status).toBe(409)
    expect(referenced.body).toMatchObject({
      message: "该镜像被容器使用中，请先删除相关容器，或显式选择强制删除",
    })
  })

  it("卷与网络删除：内置网络与在用卷都被拒绝", async () => {
    const volume = await send("DELETE", "/api/docker/volume", {
      body: { name: "smoke-vol" },
      requestId: "req-int-volume-0001",
    })
    expect(volume.status).toBe(200)
    expect(volume.body).toEqual({ message: "已删除卷 smoke-vol" })

    const network = await send("DELETE", "/api/docker/network", {
      body: { networkId: "smoke-net" },
      requestId: "req-int-network-0001",
    })
    expect(network.status).toBe(200)
    expect(network.body).toEqual({ message: "已删除网络 smoke-net" })

    const builtin = await send("DELETE", "/api/docker/network", {
      body: { networkId: "bridge" },
      requestId: "req-int-network-0002",
    })
    expect(builtin.status).toBe(409)
    expect(builtin.body).toMatchObject({
      message: "这是 Docker 内置网络，不能删除",
    })

    // 让卷被容器使用：删除应被拒绝，且卷还在
    state.volumes.set("busy-vol", {
      name: "busy-vol",
      driver: "local",
      mountpoint: "/var/lib/docker/volumes/busy-vol/_data",
      createdAt: 1_790_000_000_000,
      sizeBytes: null,
      inUse: true,
    })
    state.containers.set("c3", {
      ...containerOf("c3", "busy-user"),
      mounts: [
        {
          type: "volume",
          source: "/var/lib/docker/volumes/busy-vol/_data",
          destination: "/data",
          readOnly: false,
        },
      ],
    })
    const inUse = await send("DELETE", "/api/docker/volume", {
      body: { name: "busy-vol" },
      requestId: "req-int-volume-0002",
    })
    expect(inUse.status).toBe(409)
    expect(inUse.body).toMatchObject({
      message: "该卷正被容器使用，请先删除相关容器",
    })
    expect(state.volumes.has("busy-vol")).toBe(true)
  })

  it("Colima 动作按状态给出 409 / 200，并以真实状态核实", async () => {
    // 正在运行时 start 是状态冲突，且不执行任何动作
    const alreadyRunning = await send("POST", "/api/docker/colima/action", {
      body: { action: "start" },
      requestId: "req-int-colima-0001",
    })
    expect(alreadyRunning.status).toBe(409)
    expect(alreadyRunning.body).toEqual({
      message: "Colima 已在运行",
      executionStatus: "not_started",
    })
    expect(state.calls).toEqual([])

    // 未运行时 stop 同样是状态冲突
    state.colimaRunning = false
    const alreadyStopped = await send("POST", "/api/docker/colima/action", {
      body: { action: "stop" },
      requestId: "req-int-colima-0002",
    })
    expect(alreadyStopped.status).toBe(409)
    expect(alreadyStopped.body).toMatchObject({ message: "Colima 未在运行" })

    // 未运行时 start 成功，并以 colima status 核实
    const start = await send("POST", "/api/docker/colima/action", {
      body: { action: "start" },
      requestId: "req-int-colima-0003",
    })
    expect(start.status).toBe(200)
    expect(start.body).toEqual({ message: "Colima 已启动" })
    expect(state.colimaRunning).toBe(true)
  })

  it("长任务（202）在受理期间读列表后，完成时仍能看到新对象", async () => {
    // 先让列表被读一次（填充父进程缓存），再提交一个稍后才执行完的写操作
    expect(await send("GET", "/api/docker/images")).toMatchObject({
      status: 200,
    })
    state.holdMs = 600
    const pull = await send("POST", "/api/docker/images/pull", {
      body: { image: "alpine:3.20" },
      requestId: "req-int-late-0001",
    })
    expect(pull.status).toBe(202)
    const taskId = (pull.body as { taskId: string }).taskId

    // 受理期间读一次：这时镜像确实还没有，缓存里会存下这个快照
    const during = await send("GET", "/api/docker/images")
    expect(
      (during.body as { images: DockerImage[] }).images.map(
        (item) => item.repository
      )
    ).not.toContain("alpine")

    // 等任务真正结束
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const detail = await send("GET", `/api/tasks/${taskId}`)
      if ((detail.body as { status: string }).status !== "running") break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    // 完成后的第一次读取必须看到新镜像（写宽限期内不命中旧快照）
    const after = await send("GET", "/api/docker/images")
    expect(
      (after.body as { images: DockerImage[] }).images.map((item) => item.tag)
    ).toContain("3.20")
  })

  it("载荷非法与请求标识过短都由契约拒绝", async () => {
    const illegalAction = await send("POST", "/api/docker/containers/action", {
      body: { containerId: "c1", action: "shellExec" },
      requestId: "req-int-illegal-0001",
    })
    expect(illegalAction.status).toBe(400)

    const shortRequestId = await send("POST", "/api/docker/images/pull", {
      body: { image: "alpine:3.20" },
      requestId: "short",
    })
    expect(shortRequestId.status).toBe(400)

    const injected = await send("POST", "/api/docker/containers", {
      body: { image: "redis:7-alpine", command: "rm -rf /" },
      requestId: "req-int-injected-0001",
    })
    // command 只接受字符串数组：透传 shell 文本会被契约拒绝
    expect(injected.status).toBe(400)
  })
})
