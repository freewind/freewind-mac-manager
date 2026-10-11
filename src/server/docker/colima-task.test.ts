import { PublicOperationError } from "@server/common/public-error"
import { createExecutorRegistry, taskExecutors } from "@server/tasks/executors"
import { TASK_KINDS, type TaskProgress } from "@shared/api-contract"
import { dockerColimaTaskTarget } from "@shared/task-targets"
import { describe, expect, it } from "vitest"
import {
  COLIMA_ACTION_KIND,
  type ColimaActionCli,
  ColimaActionPayloadSchema,
  runColimaActionTask,
} from "./colima-task"

/** 受控替身：动作会真的改「虚拟机」状态，除非 stuck。 */
const createFakeCli = (
  options: { running?: boolean; stuck?: boolean } = {}
) => {
  let running = options.running ?? false
  const calls: string[] = []
  const cli: ColimaActionCli = {
    startColima: async () => {
      calls.push("startColima")
      if (options.stuck !== true) running = true
      return "colima started"
    },
    stopColima: async () => {
      calls.push("stopColima")
      if (options.stuck !== true) running = false
      return "colima stopped"
    },
    getColimaStatus: async () => ({
      installed: true,
      running,
      status: running ? "colima 运行中" : "colima 未运行",
      runtime: null,
      arch: null,
      cpus: null,
      memoryBytes: null,
      diskBytes: null,
      checkedAt: 1_700_000_000_000,
    }),
  }
  return { cli, calls }
}

const runWith = async (
  payload: unknown,
  options: { running?: boolean; stuck?: boolean } = {}
) => {
  const { cli, calls } = createFakeCli(options)
  const reports: TaskProgress[] = []
  const promise = runColimaActionTask({
    payload,
    report: (progress) => reports.push(progress),
    cli,
  })
  return { promise, calls, reports }
}

describe("Colima 动作载荷", () => {
  it("只接受三个枚举值，多余字段直接拒绝", () => {
    for (const action of ["start", "stop", "restart"]) {
      expect(ColimaActionPayloadSchema.safeParse({ action }).success).toBe(true)
    }
    expect(
      ColimaActionPayloadSchema.safeParse({ action: "rm -rf /" }).success
    ).toBe(false)
    expect(
      ColimaActionPayloadSchema.safeParse({ action: "start", force: true })
        .success
    ).toBe(false)
    expect(
      ColimaActionPayloadSchema.safeParse({
        action: "start",
        command: "/bin/sh -c stop",
      }).success
    ).toBe(false)
    expect(ColimaActionPayloadSchema.safeParse({}).success).toBe(false)
  })

  it("载荷非法时不发任何命令", async () => {
    const { cli, calls } = createFakeCli()
    await expect(
      runColimaActionTask({
        payload: { action: "restart", command: "colima stop" },
        report: () => undefined,
        cli,
      })
    ).rejects.toThrow("Colima 动作载荷非法")
    expect(calls).toHaveLength(0)
  })
})

describe("Colima 动作执行", () => {
  it("start 分派到 startColima，并以 status 核实后报「已启动」", async () => {
    const { promise, calls, reports } = await runWith(
      { action: "start" },
      { running: false }
    )
    const outcome = await promise
    expect(calls).toEqual(["startColima"])
    expect(outcome.message).toBe("Colima 已启动")
    expect(reports.map((item) => item.stage)).toEqual([
      "正在启动 Colima 虚拟机",
      "正在等待 Colima 就绪",
      "完成",
    ])
    expect(reports[0]?.currentTarget).toBe(dockerColimaTaskTarget())
  })

  it("stop 分派到 stopColima，并以 status 核实后报「已停止」", async () => {
    const { promise, calls } = await runWith(
      { action: "stop" },
      { running: true }
    )
    expect((await promise).message).toBe("Colima 已停止")
    expect(calls).toEqual(["stopColima"])
  })

  it("restart 的顺序是先 stop 再 start", async () => {
    const { promise, calls } = await runWith(
      { action: "restart" },
      { running: true }
    )
    expect((await promise).message).toBe("Colima 已重启")
    expect(calls).toEqual(["stopColima", "startColima"])
  })

  it("命令成功但状态没变时报错，不谎报成功", async () => {
    const failing = await runWith(
      { action: "start" },
      { running: false, stuck: true }
    )
    const error = await failing.promise.catch((value: unknown) => value)
    expect(error).toBeInstanceOf(PublicOperationError)
    expect((error as PublicOperationError).status).toBe(500)
    expect((error as PublicOperationError).message).toContain(
      "未能进入运行状态"
    )

    const stopStuck = await runWith(
      { action: "stop" },
      { running: true, stuck: true }
    )
    await expect(stopStuck.promise).rejects.toThrow("未能停止")
  })

  it("restart 中途停不下来就报错，不会再发 start", async () => {
    const { promise, calls } = await runWith(
      { action: "restart" },
      { running: true, stuck: true }
    )
    await expect(promise).rejects.toThrow("未能停止")
    expect(calls).toEqual(["stopColima"])
  })
})

describe("Colima 执行器登记", () => {
  it("注册表里有 docker_colima_action", () => {
    const registry = createExecutorRegistry(taskExecutors)
    expect(registry.get(COLIMA_ACTION_KIND)).not.toBeNull()
    expect(registry.kinds()).toContain(TASK_KINDS.dockerColimaAction)
  })

  it("注册表里的执行器同样拒绝非法载荷", async () => {
    const executor =
      createExecutorRegistry(taskExecutors).get(COLIMA_ACTION_KIND)
    await expect(
      executor?.run(
        { action: "stop", command: "colima stop" },
        { report: () => undefined }
      )
    ).rejects.toThrow("Colima 动作载荷非法")
  })
})
