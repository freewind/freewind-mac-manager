import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { TaskRunner } from "@server/common/tasks/runner"
import { TaskStore } from "@server/common/tasks/store"
import type {
  TaskJob,
  TaskOutcome,
  TaskRunContext,
  TaskRunnerHost,
} from "@server/common/tasks/worker-host"
import { createExecutorRegistry, taskExecutors } from "@server/tasks/executors"
import { TASK_KINDS, type TaskProgress } from "@shared/api-contract"
import {
  dockerColimaTaskTarget,
  dockerContainerTaskTarget,
  dockerImageTaskTarget,
  dockerNetworkTaskTarget,
  dockerVolumeTaskTarget,
} from "@shared/task-targets"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  DOCKER_ACTION_KIND,
  type DockerActionCli,
  type DockerActionPayload,
  DockerActionPayloadSchema,
  dockerActionTargetOf,
  runDockerActionTask,
} from "./task"

type Call = { method: string; args: unknown[] }

/** 受控替身：只记录调用了哪个写方法、带了什么参数，不真的执行 docker。 */
const createFakeCli = (): { cli: DockerActionCli; calls: Call[] } => {
  const calls: Call[] = []
  const cli: DockerActionCli = {
    startContainer: async (containerId) => {
      calls.push({ method: "startContainer", args: [containerId] })
    },
    stopContainer: async (containerId, options) => {
      calls.push({ method: "stopContainer", args: [containerId, options] })
    },
    restartContainer: async (containerId, options) => {
      calls.push({ method: "restartContainer", args: [containerId, options] })
    },
    removeContainer: async (containerId, options) => {
      calls.push({ method: "removeContainer", args: [containerId, options] })
    },
    createContainer: async (config) => {
      calls.push({ method: "createContainer", args: [config] })
      return "new-container-id"
    },
    pullImage: async (image) => {
      calls.push({ method: "pullImage", args: [image] })
    },
    removeImage: async (imageId, options) => {
      calls.push({ method: "removeImage", args: [imageId, options] })
    },
    removeVolume: async (name) => {
      calls.push({ method: "volumeRemove", args: [name] })
    },
    removeNetwork: async (networkId) => {
      calls.push({ method: "networkRemove", args: [networkId] })
    },
  }
  return { cli, calls }
}

const LEGAL_PAYLOADS: DockerActionPayload[] = [
  { action: "containerStart", containerId: "3a2352da7b30" },
  { action: "containerStop", containerId: "3a2352da7b30", force: true },
  { action: "containerRestart", containerId: "3a2352da7b30" },
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
    expect(outcome.message).toBe("卷 myvol 已删除")
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
