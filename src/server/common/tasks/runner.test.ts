import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TaskRunner } from "./runner"
import { TaskStore } from "./store"
import type {
  TaskJob,
  TaskOutcome,
  TaskRunContext,
  TaskRunnerHost,
} from "./worker-host"

type Call = {
  job: TaskJob
  context: TaskRunContext
  resolve: (outcome: TaskOutcome) => void
  reject: (error: unknown) => void
}

const makeHost = () => {
  const calls: Call[] = []
  const host: TaskRunnerHost = {
    execute: (job, context) =>
      new Promise<TaskOutcome>((resolve, reject) => {
        calls.push({ job, context, resolve, reject })
      }),
  }
  return { host, calls }
}

const ok = (
  result: unknown,
  status: "done" | "partial" = "done"
): TaskOutcome => ({ result, message: "完成", status })

const toCompletedResponse = (outcome: TaskOutcome) => ({
  status: 200 as const,
  body: outcome,
})

type Harness = ReturnType<typeof makeHarness>

const makeHarness = (thresholdMs: number) => {
  const dir = mkdtempSync(path.join(tmpdir(), "mac-manager-runner-"))
  const store = new TaskStore(path.join(dir, "tasks.sqlite3"))
  const { host, calls } = makeHost()
  const runner = new TaskRunner({ store, host, thresholdMs })
  return { dir, store, runner, host, calls }
}

let harness: Harness

beforeEach(() => {
  harness = makeHarness(30)
})

afterEach(() => {
  harness.runner.shutdown()
  harness.store.close()
  rmSync(harness.dir, { recursive: true, force: true })
})

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 2000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("等待超时")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe("task runner", () => {
  it("returns the real result when the work finishes inside the threshold", async () => {
    const { runner, calls, store } = harness
    const submission = runner.submit({
      kind: "file_delete",
      target: "/tmp/a",
      payload: { paths: ["/tmp/a"] },
      requestId: null,
      toCompletedResponse,
    })
    await waitFor(() => calls.length === 1)
    calls[0].resolve(ok({ deleted: 1 }))

    const result = await submission
    expect(result.kind).toBe("completed")
    expect(result).toMatchInlineSnapshot(`
      {
        "body": {
          "message": "完成",
          "result": {
            "deleted": 1,
          },
          "status": "done",
        },
        "kind": "completed",
        "status": 200,
      }
    `)
    expect(calls).toHaveLength(1)
    expect(store.get(calls[0].job.taskId)?.status).toBe("done")
  })

  it("registers the task before the side effect starts", async () => {
    const { runner, calls, store } = harness
    const submission = runner.submit({
      kind: "file_delete",
      target: "/tmp/a",
      payload: {},
      requestId: "req-0000000000000001",
      toCompletedResponse,
    })
    await waitFor(() => calls.length === 1)
    // 已经开始执行时，任务必须已经存在于库中
    const row = store.findByRequestId("req-0000000000000001")
    expect(row?.status).toBe("running")
    expect(row?.id).toBe(calls[0].job.taskId)
    calls[0].resolve(ok({}))
    await submission
  })

  it("returns an accepted receipt for slow work and still finishes exactly once", async () => {
    const { runner, calls, store } = harness
    const result = await runner.submit({
      kind: "disk_scan",
      target: "scan:/",
      payload: {},
      requestId: "req-0000000000000002",
      toCompletedResponse,
    })
    expect(result.kind).toBe("accepted")
    const taskId = result.kind === "accepted" ? result.body.taskId : ""
    expect(result).toMatchObject({
      body: { kind: "disk_scan", status: "running" },
    })
    expect(store.get(taskId)?.status).toBe("running")

    calls[0].resolve(ok({ snapshotId: 3 }))
    await waitFor(() => store.get(taskId)?.status === "done")
    expect(store.get(taskId)?.result).toBe(JSON.stringify({ snapshotId: 3 }))
    expect(store.listActive()).toHaveLength(0)
    // 完成后重复结束不会改动状态
    expect(
      store.finish(taskId, {
        status: "failed",
        result: null,
        message: null,
        error: "late",
        finishedAt: 1,
      })
    ).toBe(false)
  })

  it("replays the original outcome for the same request id without executing twice", async () => {
    const { runner, calls, store } = harness
    const first = runner.submit({
      kind: "file_delete",
      target: "/tmp/a",
      payload: { paths: ["/tmp/a"] },
      requestId: "req-0000000000000003",
      toCompletedResponse,
    })
    await waitFor(() => calls.length === 1)
    calls[0].resolve(ok({ deleted: 1 }))
    expect((await first).kind).toBe("completed")

    const replay = await runner.submit({
      kind: "file_delete",
      target: "/tmp/a",
      payload: { paths: ["/tmp/a"] },
      requestId: "req-0000000000000003",
      toCompletedResponse,
    })
    expect(replay.kind).toBe("completed")
    expect(calls).toHaveLength(1)
    expect(store.listActive()).toHaveLength(0)
  })

  it("reports the task id again for a repeated request while it is still running", async () => {
    const { runner, calls } = harness
    const request = {
      kind: "file_copy" as const,
      target: "/tmp/a",
      payload: { paths: ["/tmp/a"], destPath: "/tmp/b" },
      requestId: "req-0000000000000004",
      toCompletedResponse,
    }
    const first = await runner.submit(request)
    const second = await runner.submit(request)
    expect(first.kind).toBe("accepted")
    expect(second).toMatchObject({
      kind: "accepted",
      body: { taskId: first.kind === "accepted" ? first.body.taskId : "" },
    })
    expect(calls).toHaveLength(1)
  })

  it("rejects a different payload that reuses a request id", async () => {
    const { runner, calls } = harness
    const first = runner.submit({
      kind: "file_delete",
      target: "/tmp/a",
      payload: { paths: ["/tmp/a"] },
      requestId: "req-0000000000000005",
      toCompletedResponse,
    })
    await waitFor(() => calls.length === 1)
    const conflict = await runner.submit({
      kind: "file_delete",
      target: "/tmp/a",
      payload: { paths: ["/tmp/other"] },
      requestId: "req-0000000000000005",
      toCompletedResponse,
    })
    expect(conflict).toMatchObject({ kind: "conflict" })
    calls[0].resolve(ok({}))
    await first
  })

  it("rejects a new request for a target that is already busy", async () => {
    const { runner, calls } = harness
    const first = runner.submit({
      kind: "file_delete",
      target: "/tmp/a",
      payload: { paths: ["/tmp/a"] },
      requestId: "req-0000000000000006",
      toCompletedResponse,
    })
    await waitFor(() => calls.length === 1)
    const conflict = await runner.submit({
      kind: "file_delete",
      target: "/tmp/a",
      payload: { paths: ["/tmp/a"] },
      requestId: "req-0000000000000007",
      toCompletedResponse,
    })
    expect(conflict.kind).toBe("conflict")
    calls[0].resolve(ok({}))
    await first
  })

  it("locks by target across task kinds, not by kind", async () => {
    const { runner, calls } = harness
    const first = runner.submit({
      kind: "file_delete",
      target: "files:dir:/tmp/a",
      payload: { paths: ["/tmp/a/x"] },
      requestId: "req-0000000000000010",
      toCompletedResponse,
    })
    await waitFor(() => calls.length === 1)
    // 不同种类但同一个目标：必须先被拦住，否则创建会和删除撞在一起
    const conflict = await runner.submit({
      kind: "file_create",
      target: "files:dir:/tmp/a",
      payload: { kind: "file", parentPath: "/tmp/a", name: "new.txt" },
      requestId: "req-0000000000000011",
      toCompletedResponse,
    })
    expect(conflict.kind).toBe("conflict")
    expect(calls).toHaveLength(1)
    calls[0].resolve(ok({}))
    await first
  })

  it("locks distinct displayed paths by a shared domain lock", async () => {
    const { runner, calls, store } = harness
    const first = runner.submit({
      kind: "file_delete",
      target: "files:%2Ftmp%2Fa",
      lockTarget: "files:mutations",
      payload: { paths: ["/tmp/a"] },
      requestId: "req-0000000000000012",
      toCompletedResponse,
    })
    await waitFor(() => calls.length === 1)
    const second = await runner.submit({
      kind: "file_create",
      target: "files:dir:%2Ftmp%2Fparent",
      lockTarget: "files:mutations",
      payload: { parentPath: "/tmp/parent" },
      requestId: "req-0000000000000013",
      toCompletedResponse,
    })

    expect(second.kind).toBe("conflict")
    expect(calls).toHaveLength(1)
    expect(store.get(calls[0].job.taskId)?.target).toBe("files:%2Ftmp%2Fa")
    calls[0].resolve(ok({}))
    await first
  })

  it("returns the failure instead of pretending success", async () => {
    const { runner, calls, store } = harness
    const submission = runner.submit({
      kind: "file_delete",
      target: "/tmp/a",
      payload: {},
      requestId: "req-0000000000000008",
      toCompletedResponse,
    })
    await waitFor(() => calls.length === 1)
    calls[0].reject(new Error("权限不足"))

    const result = await submission
    expect(result).toMatchObject({ kind: "failed", message: "权限不足" })
    const row = store.findByRequestId("req-0000000000000008")
    expect(row?.status).toBe("failed")
    // 失败的请求不会自动重做
    const retry = await runner.submit({
      kind: "file_delete",
      target: "/tmp/a",
      payload: {},
      requestId: "req-0000000000000008",
      toCompletedResponse,
    })
    expect(retry.kind).toBe("failed")
    expect(calls).toHaveLength(1)
  })

  it("marks long-running work unknown when the service shuts down", async () => {
    const { runner, calls, store } = harness
    const result = await runner.submit({
      kind: "file_copy",
      target: "/tmp/a",
      payload: {},
      requestId: "req-0000000000000009",
      toCompletedResponse,
    })
    const taskId = result.kind === "accepted" ? result.body.taskId : ""
    runner.shutdown()
    expect(store.get(taskId)?.status).toBe("unknown")
    expect(calls[0].context.signal.aborted).toBe(true)
    // 关闭后不再接受新任务
    const rejected = await runner.submit({
      kind: "file_copy",
      target: "/tmp/z",
      payload: {},
      requestId: null,
      toCompletedResponse,
    })
    expect(rejected.kind).toBe("conflict")
  })

  it("throttles progress writes but keeps the latest reported numbers", async () => {
    const { runner, calls, store } = harness
    const spy = vi.spyOn(store, "updateProgress")
    const result = await runner.submit({
      kind: "disk_scan",
      target: "scan:/",
      payload: {},
      requestId: null,
      toCompletedResponse,
    })
    const taskId = result.kind === "accepted" ? result.body.taskId : ""
    const { context } = calls[0]
    const progress = {
      done: 1,
      total: null,
      bytesDone: 10,
      bytesTotal: null,
      stage: "统计文件",
      currentTarget: "/Users/demo",
    }
    // 连续上报只应落库一次，避免打满数据库
    context.onProgress(progress)
    context.onProgress({ ...progress, done: 2 })
    context.onProgress({ ...progress, done: 3 })
    expect(spy.mock.calls.length).toBe(1)
    expect(store.get(taskId)?.progress).toContain('"done":1')
    calls[0].resolve(ok({}))
    await waitFor(() => store.get(taskId)?.status === "done")
  })

  it("runs scheduled tasks that have no request id", async () => {
    const { runner, calls, store } = harness
    const submission = runner.submit({
      kind: "disk_scan",
      target: "scan:/",
      payload: { scheduled: true },
      requestId: null,
      toCompletedResponse,
    })
    await waitFor(() => calls.length === 1)
    calls[0].resolve(ok({ snapshotId: 9 }))
    expect((await submission).kind).toBe("completed")
    const { rows } = store.list({ statuses: ["done"], limit: 10, offset: 0 })
    expect(rows[0].requestId).toBeNull()
  })
})
