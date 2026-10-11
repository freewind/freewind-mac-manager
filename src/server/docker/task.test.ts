import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { PublicOperationError } from "@server/common/public-error"
import { TaskRunner } from "@server/common/tasks/runner"
import { TaskStore } from "@server/common/tasks/store"
import type {
  TaskJob,
  TaskOutcome,
  TaskRunContext,
  TaskRunnerHost,
} from "@server/common/tasks/worker-host"
import { createExecutorRegistry, taskExecutors } from "@server/tasks/executors"
import {
  type DockerContainer,
  TASK_KINDS,
  type TaskProgress,
} from "@shared/api-contract"
import {
  dockerColimaTaskTarget,
  dockerContainerTaskTarget,
  dockerImageTaskTarget,
  dockerNetworkTaskTarget,
  dockerVolumeTaskTarget,
} from "@shared/task-targets"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DockerCommandError } from "./cli"
import {
  DOCKER_ACTION_KIND,
  type DockerActionCli,
  type DockerActionPayload,
  DockerActionPayloadSchema,
  dockerActionTargetOf,
  runDockerActionTask,
} from "./task"

type Call = { method: string; args: unknown[] }

/** 受控替身：动作会真的改状态（除非 stuck），核实读到的就是改完之后的状态。 */
const createFakeCli = (
  options: {
    state?: string
    stuck?: boolean
    /** 拉取输出：按行喂给 onLine，模拟 docker 的流式输出 */
    pullLines?: string[]
    /** 镜像是否落地 */
    imageExists?: boolean
    /** 删除镜像时报错（模拟被容器引用） */
    removeImageError?: Error
  } = {}
) => {
  let state: string = options.state ?? "running"
  let imagePresent = options.imageExists ?? true
  const calls: Call[] = []
  const move = (next: string): void => {
    if (options.stuck !== true) state = next
  }
  const cli: DockerActionCli = {
    startContainer: async (containerId) => {
      calls.push({ method: "startContainer", args: [containerId] })
      move("running")
    },
    stopContainer: async (containerId, stopOptions) => {
      calls.push({ method: "stopContainer", args: [containerId, stopOptions] })
      move("exited")
    },
    restartContainer: async (containerId, restartOptions) => {
      calls.push({
        method: "restartContainer",
        args: [containerId, restartOptions],
      })
      move("running")
    },
    killContainer: async (containerId) => {
      calls.push({ method: "killContainer", args: [containerId] })
      move("exited")
    },
    removeContainer: async (containerId, removeOptions) => {
      calls.push({
        method: "removeContainer",
        args: [containerId, removeOptions],
      })
      move("removed")
    },
    createContainer: async (config) => {
      calls.push({ method: "createContainer", args: [config] })
      return "new-container-id"
    },
    pullImage: async (image, pullOptions) => {
      calls.push({ method: "pullImage", args: [image] })
      for (const line of options.pullLines ?? []) pullOptions?.onLine?.(line)
      // 拉取结束镜像就落地了（除非用例显式设为 false 来验证核实失败）
      imagePresent = options.imageExists ?? true
    },
    imageExists: async () => imagePresent,
    removeImage: async (imageId, removeOptions) => {
      calls.push({ method: "removeImage", args: [imageId, removeOptions] })
      if (options.removeImageError !== undefined) throw options.removeImageError
      imagePresent = false
    },
    removeVolume: async (name) => {
      calls.push({ method: "volumeRemove", args: [name] })
    },
    removeNetwork: async (networkId) => {
      calls.push({ method: "networkRemove", args: [networkId] })
    },
    inspectContainer: async (containerId) =>
      state === "removed"
        ? null
        : {
            id: containerId,
            name: "smoke",
            image: "redis:7-alpine",
            command: "redis-server",
            state: state as DockerContainer["state"],
            status: state,
            createdAt: 1_700_000_000_000,
            startedAt: state === "running" ? 1_700_000_000_500 : null,
            ports: [],
            mounts: [],
          },
  }
  return { cli, calls, stateOf: () => state }
}

const LEGAL_PAYLOADS: DockerActionPayload[] = [
  { action: "containerStart", containerId: "3a2352da7b30" },
  { action: "containerStop", containerId: "3a2352da7b30", force: true },
  { action: "containerRestart", containerId: "3a2352da7b30" },
  { action: "containerKill", containerId: "3a2352da7b30" },
  { action: "containerRemove", containerId: "3a2352da7b30", force: true },
  { action: "containerCreate", container: { image: "nginx:latest" } },
  { action: "imagePull", image: "nginx:latest" },
  { action: "imageRemove", imageId: "sha256:3d88bd757134" },
  { action: "volumeRemove", name: "opendecider-models" },
  { action: "networkRemove", networkId: "net1" },
]

describe("Docker 动作载荷", () => {
  it("接受 9 个动作的合法载荷", () => {
    for (const payload of LEGAL_PAYLOADS) {
      expect(
        DockerActionPayloadSchema.safeParse(payload).success,
        JSON.stringify(payload)
      ).toBe(true)
    }
  })

  it("拒绝非法标识、未知动作与偷塞的命令字段", () => {
    const illegal: unknown[] = [
      { action: "containerStart", containerId: "../../etc/passwd" },
      { action: "containerStart", containerId: "--force" },
      { action: "containerStart", containerId: "" },
      { action: "containerStart" },
      { action: "containerRemove", containerId: "abc", command: "rm -rf /" },
      { action: "containerRemove", containerId: "abc", shell: "/bin/sh -c" },
      { action: "containerStop", containerId: "abc", dockerArgs: ["-f"] },
      { action: "imagePull", image: "--help" },
      { action: "imagePull", image: "nginx && rm -rf /" },
      { action: "volumeRemove", name: "a b" },
      { action: "networkRemove", networkId: "net1; rm -rf /" },
      { action: "shellExec", command: "rm -rf /" },
    ]
    for (const payload of illegal) {
      expect(
        DockerActionPayloadSchema.safeParse(payload).success,
        JSON.stringify(payload)
      ).toBe(false)
    }
  })

  it("载荷非法时不发任何 docker 命令", async () => {
    const { cli, calls } = createFakeCli()
    const report = (): void => undefined
    await expect(
      runDockerActionTask({
        payload: {
          action: "containerRemove",
          containerId: "../../etc",
          command: "rm -rf /",
        },
        report,
        cli,
      })
    ).rejects.toThrow("Docker 动作载荷非法")
    await expect(
      runDockerActionTask({
        payload: { action: "shellExec", command: "rm -rf /" },
        report,
        cli,
      })
    ).rejects.toThrow("Docker 动作载荷非法")
    expect(calls).toHaveLength(0)
  })
})

describe("Docker 动作分派", () => {
  it("每个动作都分派到对应的 cli 方法", async () => {
    const expected: { payload: DockerActionPayload; method: string }[] = [
      {
        payload: { action: "containerStart", containerId: "abc" },
        method: "startContainer",
      },
      {
        payload: { action: "containerStop", containerId: "abc", force: true },
        method: "stopContainer",
      },
      {
        payload: { action: "containerRestart", containerId: "abc" },
        method: "restartContainer",
      },
      {
        payload: { action: "containerKill", containerId: "abc" },
        method: "killContainer",
      },
      {
        payload: { action: "containerRemove", containerId: "abc" },
        method: "removeContainer",
      },
      {
        payload: { action: "containerCreate", container: { image: "redis:7" } },
        method: "createContainer",
      },
      {
        payload: { action: "imagePull", image: "redis:7" },
        method: "pullImage",
      },
      {
        payload: { action: "imageRemove", imageId: "sha256:abc" },
        method: "removeImage",
      },
      {
        payload: { action: "volumeRemove", name: "myvol" },
        method: "volumeRemove",
      },
      {
        payload: { action: "networkRemove", networkId: "net1" },
        method: "networkRemove",
      },
    ]
    for (const item of expected) {
      const { cli, calls } = createFakeCli()
      const outcome = await runDockerActionTask({
        payload: item.payload,
        report: () => undefined,
        cli,
      })
      expect(
        calls.map((call) => call.method),
        item.method
      ).toEqual([item.method])
      expect(outcome.result.message.length).toBeGreaterThan(0)
    }
  })

  it("force 与容器标识按原样交给 cli", async () => {
    const { cli, calls } = createFakeCli()
    await runDockerActionTask({
      payload: { action: "containerStop", containerId: "3a2352da7b30" },
      report: () => undefined,
      cli,
    })
    await runDockerActionTask({
      payload: {
        action: "containerRemove",
        containerId: "3a2352da7b30",
        force: true,
      },
      report: () => undefined,
      cli,
    })
    expect(calls).toMatchInlineSnapshot(`
      [
        {
          "args": [
            "3a2352da7b30",
            {
              "force": undefined,
            },
          ],
          "method": "stopContainer",
        },
        {
          "args": [
            "3a2352da7b30",
            {
              "force": true,
            },
          ],
          "method": "removeContainer",
        },
      ]
    `)
  })

  it("上报中文 stage 与作用域，完成后归零", async () => {
    const reports: TaskProgress[] = []
    const { cli } = createFakeCli()
    const outcome = await runDockerActionTask({
      payload: { action: "volumeRemove", name: "myvol" },
      report: (progress) => reports.push(progress),
      cli,
    })
    expect(reports).toMatchInlineSnapshot(`
      [
        {
          "bytesDone": null,
          "bytesTotal": null,
          "currentTarget": "docker:volume:myvol",
          "done": 0,
          "stage": "删除卷 myvol",
          "total": 1,
        },
        {
          "bytesDone": null,
          "bytesTotal": null,
          "currentTarget": null,
          "done": 1,
          "stage": "完成",
          "total": 1,
        },
      ]
    `)
    expect(outcome.message).toBe(
      "已发出删除卷 myvol 的命令，请重新读取列表确认"
    )
  })

  it("容器动作以重新读取到的状态为准，不认命令退出码", async () => {
    const started = createFakeCli({ state: "exited" })
    expect(
      await runDockerActionTask({
        payload: { action: "containerStart", containerId: "3a2352da7b30" },
        report: () => undefined,
        cli: started.cli,
      })
    ).toMatchObject({ message: "已启动 smoke" })
    expect(started.stateOf()).toBe("running")

    const killed = createFakeCli({ state: "running" })
    expect(
      await runDockerActionTask({
        payload: { action: "containerKill", containerId: "3a2352da7b30" },
        report: () => undefined,
        cli: killed.cli,
      })
    ).toMatchObject({ message: "已终止 smoke" })

    const removed = createFakeCli({ state: "running" })
    expect(
      await runDockerActionTask({
        payload: {
          action: "containerRemove",
          containerId: "3a2352da7b30",
          force: true,
        },
        report: () => undefined,
        cli: removed.cli,
      })
    ).toMatchObject({ message: "已删除 smoke" })
  })

  it("状态没变时如实报失败，不谎报成功", async () => {
    // stop 命令“成功”了，但 inspect 仍是 running
    const stuck = createFakeCli({ state: "running", stuck: true })
    await expect(
      runDockerActionTask({
        payload: { action: "containerStop", containerId: "3a2352da7b30" },
        report: () => undefined,
        cli: stuck.cli,
      })
    ).rejects.toThrow("仍在运行")

    // rm 命令“成功”了，但容器还在
    const notRemoved = createFakeCli({ state: "exited", stuck: true })
    await expect(
      runDockerActionTask({
        payload: { action: "containerRemove", containerId: "3a2352da7b30" },
        report: () => undefined,
        cli: notRemoved.cli,
      })
    ).rejects.toThrow("仍然存在")

    // 启动后状态还是 exited
    await expect(
      runDockerActionTask({
        payload: { action: "containerStart", containerId: "3a2352da7b30" },
        report: () => undefined,
        cli: createFakeCli({ state: "exited", stuck: true }).cli,
      })
    ).rejects.toThrow("未启动成功")
  })
})

describe("Docker 任务作用域", () => {
  it("同对象稳定，不同对象不同", () => {
    expect(dockerContainerTaskTarget("abc")).toBe("docker:container:abc")
    expect(dockerContainerTaskTarget("abc")).toBe(
      dockerContainerTaskTarget("abc")
    )
    expect(dockerContainerTaskTarget("abc")).not.toBe(
      dockerContainerTaskTarget("def")
    )
    expect(dockerImageTaskTarget("nginx:latest")).toBe(
      "docker:image:nginx:latest"
    )
    expect(dockerImageTaskTarget("nginx:latest")).not.toBe(
      dockerImageTaskTarget("redis:7")
    )
    expect(dockerVolumeTaskTarget("myvol")).toBe("docker:volume:myvol")
    expect(dockerNetworkTaskTarget("net1")).toBe("docker:network:net1")
    expect(dockerColimaTaskTarget()).toBe("docker:colima")
  })

  it("同一容器的不同动作共用一个作用域，不同容器互不影响", () => {
    expect(
      dockerActionTargetOf({ action: "containerStart", containerId: "a" })
    ).toBe(dockerActionTargetOf({ action: "containerStop", containerId: "a" }))
    expect(
      dockerActionTargetOf({ action: "containerStart", containerId: "a" })
    ).not.toBe(
      dockerActionTargetOf({ action: "containerStart", containerId: "b" })
    )
    expect(
      dockerActionTargetOf({ action: "imagePull", image: "nginx:latest" })
    ).toBe(
      dockerActionTargetOf({
        action: "imageRemove",
        imageId: "nginx:latest",
      })
    )
    expect(
      dockerActionTargetOf({ action: "volumeRemove", name: "myvol" })
    ).toBe("docker:volume:myvol")
    expect(
      dockerActionTargetOf({ action: "networkRemove", networkId: "net1" })
    ).toBe("docker:network:net1")
    expect(
      dockerActionTargetOf({
        action: "containerCreate",
        container: { image: "redis:7", name: "cache" },
      })
    ).toBe("docker:container:cache")
  })
})

describe("Docker 执行器登记", () => {
  it("注册表里有 docker_action", () => {
    const registry = createExecutorRegistry(taskExecutors)
    expect(registry.get(DOCKER_ACTION_KIND)).not.toBeNull()
    expect(registry.kinds()).toContain(TASK_KINDS.dockerAction)
  })

  it("注册表里的执行器同样拒绝非法载荷", async () => {
    const executor =
      createExecutorRegistry(taskExecutors).get(DOCKER_ACTION_KIND)
    expect(executor).not.toBeNull()
    await expect(
      executor?.run(
        { action: "shellExec", command: "rm -rf /" },
        { report: () => undefined }
      )
    ).rejects.toThrow("Docker 动作载荷非法")
  })
})

describe("任务运行时的幂等与互斥", () => {
  type Harness = {
    dir: string
    store: TaskStore
    runner: TaskRunner
    calls: { job: TaskJob; context: TaskRunContext }[]
  }
  let harness: Harness

  beforeEach(() => {
    const dir = mkdtempSync(path.join(tmpdir(), "mac-manager-docker-task-"))
    const store = new TaskStore(path.join(dir, "tasks.sqlite3"))
    const calls: Harness["calls"] = []
    const host: TaskRunnerHost = {
      execute: (job, context) =>
        // 一直不结束：模拟任务仍在执行，用来看冲突判定。
        new Promise<TaskOutcome>(() => {
          calls.push({ job, context })
        }),
    }
    harness = {
      dir,
      store,
      runner: new TaskRunner({ store, host, thresholdMs: 20 }),
      calls,
    }
  })

  afterEach(() => {
    harness.runner.shutdown()
    harness.store.close()
    rmSync(harness.dir, { recursive: true, force: true })
  })

  const submit = (target: string, requestId: string | null, payload: unknown) =>
    harness.runner.submit({
      kind: DOCKER_ACTION_KIND,
      target,
      payload,
      requestId,
      toCompletedResponse: (outcome) => ({
        status: 200 as const,
        body: outcome,
      }),
    })

  it("同对象第二次提交判为冲突，不同对象可以并行", async () => {
    const payload: DockerActionPayload = {
      action: "containerStart",
      containerId: "3a2352da7b30",
    }
    const target = dockerContainerTaskTarget("3a2352da7b30")
    const first = await submit(target, null, payload)
    expect(first.kind).toBe("accepted")

    const same = await submit(target, null, payload)
    expect(same).toMatchObject({ kind: "conflict" })

    const other = await submit(
      dockerContainerTaskTarget("d953d207e653"),
      null,
      payload
    )
    expect(other.kind).toBe("accepted")
    // 冲突的请求没有启动第二次执行
    expect(harness.calls).toHaveLength(2)
  })

  it("同 requestId 重发不会第二次执行", async () => {
    const payload: DockerActionPayload = {
      action: "imagePull",
      image: "nginx:latest",
    }
    const target = dockerImageTaskTarget("nginx:latest")
    const requestId = "req-docker-abcdefgh"
    expect((await submit(target, requestId, payload)).kind).toBe("accepted")
    expect((await submit(target, requestId, payload)).kind).toBe("accepted")
    expect(harness.calls).toHaveLength(1)
  })
})

describe("新建容器的核实", () => {
  it("创建后核实为 running 才算启动成功，并带回新容器标识", async () => {
    const { cli } = createFakeCli({ state: "running" })
    const outcome = await runDockerActionTask({
      payload: {
        action: "containerCreate",
        container: { image: "redis:7-alpine", name: "smoke-new" },
      },
      report: () => undefined,
      cli,
    })
    expect(outcome.message).toBe("已创建并启动 smoke")
    expect(outcome.result).toEqual({
      message: "已创建并启动 smoke",
      containerId: "new-container-id",
      name: "smoke",
    })
  })

  it("容器创建后立刻退出时如实说明状态，不报成启动成功", async () => {
    const { cli } = createFakeCli({ state: "exited" })
    const outcome = await runDockerActionTask({
      payload: {
        action: "containerCreate",
        container: { image: "redis:7-alpine", name: "smoke-new" },
      },
      report: () => undefined,
      cli,
    })
    expect(outcome.message).toBe(
      "容器 smoke 已创建，但状态是 exited，请查看日志确认原因"
    )
    expect(outcome.message).not.toContain("已创建并启动")
    expect(outcome.result.containerId).toBe("new-container-id")
  })

  it("核实不到新容器时如实报失败", async () => {
    const { cli } = createFakeCli()
    await expect(
      runDockerActionTask({
        payload: {
          action: "containerCreate",
          container: { image: "redis:7-alpine" },
        },
        report: () => undefined,
        cli: { ...cli, inspectContainer: async () => null },
      })
    ).rejects.toThrow("已创建但查不到")
  })
})

describe("镜像拉取与删除", () => {
  it("拉取过程中按层上报真实进度，不是只在首尾各报一次", async () => {
    const reports: TaskProgress[] = []
    const { cli } = createFakeCli({
      pullLines: [
        "alpine: Pulling from library/alpine",
        "aaa111bbb222: Pulling fs layer",
        "ccc333ddd444: Pulling fs layer",
        "aaa111bbb222: Downloading 1.5MB/3MB",
        "aaa111bbb222: Pull complete",
        "ccc333ddd444: Already exists",
      ],
    })
    const outcome = await runDockerActionTask({
      payload: { action: "imagePull", image: "alpine:3.20" },
      report: (progress) => reports.push(progress),
      cli,
    })
    expect(outcome.message).toBe("镜像 alpine:3.20 拉取完成")
    const pullReports = reports.filter((item) =>
      item.stage.startsWith("正在拉取")
    )
    // 多次上报：每层出现、完成、字节变化都会推一次
    expect(pullReports.length).toBeGreaterThan(2)
    // 层数单调递增
    expect(pullReports.map((item) => item.total)).toEqual([1, 2, 2, 2, 2, 2])
    // 最后一次是命令结束后的最终态
    expect(pullReports.map((item) => item.done)).toEqual([0, 0, 0, 1, 2, 2])
    expect(pullReports.at(-1)).toMatchObject({
      done: 2,
      total: 2,
      bytesDone: 1500000,
      bytesTotal: 3000000,
      stage: "正在拉取 alpine:3.20 (2/2 层)",
      currentTarget: "alpine:3.20",
    })
  })

  it("拉取结束但镜像没落地时报错，不报成功", async () => {
    const { cli } = createFakeCli({ imageExists: false })
    await expect(
      runDockerActionTask({
        payload: { action: "imagePull", image: "alpine:3.20" },
        report: () => undefined,
        cli,
      })
    ).rejects.toThrow("本地查不到该镜像")
  })

  it("删除被容器引用的镜像返回 409，且没有加 -f", async () => {
    const { cli, calls } = createFakeCli({
      removeImageError: new DockerCommandError(
        "conflict",
        "该镜像被容器使用中，请先删除相关容器，或显式选择强制删除"
      ),
    })
    const error = await runDockerActionTask({
      payload: { action: "imageRemove", imageId: "sha256:abc" },
      report: () => undefined,
      cli,
    }).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(PublicOperationError)
    expect((error as PublicOperationError).status).toBe(409)
    expect((error as PublicOperationError).message).toBe(
      "该镜像被容器使用中，请先删除相关容器，或显式选择强制删除"
    )
    expect(calls[0]?.args).toEqual(["sha256:abc", { force: undefined }])
  })

  it("显式 force 才允许强删，删除后核实已不存在", async () => {
    const { cli, calls } = createFakeCli()
    const outcome = await runDockerActionTask({
      payload: { action: "imageRemove", imageId: "sha256:abc", force: true },
      report: () => undefined,
      cli,
    })
    expect(outcome.message).toBe("已删除镜像 sha256:abc")
    expect(calls[0]?.args).toEqual(["sha256:abc", { force: true }])
  })

  it("删除后镜像仍在时报错，不谎报成功", async () => {
    const { cli } = createFakeCli()
    await expect(
      runDockerActionTask({
        payload: { action: "imageRemove", imageId: "sha256:abc" },
        report: () => undefined,
        cli: { ...cli, imageExists: async () => true },
      })
    ).rejects.toThrow("仍然存在，删除未生效")
  })
})
