import { mkdtempSync, rmSync } from "node:fs"
import type { Server } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { createApp } from "@server/app"
import { TaskStore } from "@server/common/tasks/store"
import type { TaskOutcome } from "@server/common/tasks/worker-host"
import { TASK_REQUEST_ID_HEADER } from "@shared/api-contract"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { businessStore, command, migrate } = vi.hoisted(() => ({
  businessStore: vi.fn(() => {
    throw new Error("测试禁止打开业务数据库")
  }),
  command: vi.fn(() => {
    throw new Error("测试禁止执行真实命令")
  }),
  migrate: vi.fn(() => {
    throw new Error("测试禁止迁移业务数据库")
  }),
}))
vi.mock("@server/traffic/store", () => ({ TrafficStore: businessStore }))
vi.mock("@server/disk-growth/store", () => ({ DiskGrowthStore: businessStore }))
vi.mock("@server/traffic/migrate", () => ({ migrateTrafficDatabase: migrate }))
vi.mock("node:child_process", () => ({
  execFile: command,
  spawn: command,
  execFileSync: command,
}))

import { createTaskRuntime, type TaskRuntime } from "./runtime"

/**
 * 通过真实的 createApp 走一遍 HTTP：验证各域挂载与路径前缀没错位
 * （这类接线错误只有真正把应用搭起来才看得出来）。
 * 只触碰任务表，且用临时库与受控执行器，不写任何真实记录。
 */
let dir: string
let store: TaskStore
let runtime: TaskRuntime
let server: Server
let baseUrl: string
/** 记录被派发的任务，测试自己决定它什么时候结束。 */
let dispatched: { taskId: string; resolve: (outcome: TaskOutcome) => void }[]

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-integration-"))
  store = new TaskStore(path.join(dir, "tasks.sqlite3"))
  dispatched = []
  runtime = createTaskRuntime({
    store,
    recoverInterrupted: false,
    // 用很短的阈值跑测试，避免每个用例都等默认的 5 秒。
    thresholdMs: 30,
    host: {
      execute: (job) =>
        new Promise<TaskOutcome>((resolve) => {
          dispatched.push({ taskId: job.taskId, resolve })
        }),
    },
  })
  const app = createApp({ tasks: runtime, initializeBusiness: false })
  server = app.listen(0)
  await new Promise((resolve) => server.once("listening", resolve))
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterEach(async () => {
  runtime.runner.shutdown()
  await new Promise((resolve) => server.close(resolve))
  store.close()
  rmSync(dir, { recursive: true, force: true })
  expect(businessStore).not.toHaveBeenCalled()
  expect(command).not.toHaveBeenCalled()
  expect(migrate).not.toHaveBeenCalled()
})

const get = async (url: string) => {
  const response = await fetch(`${baseUrl}${url}`)
  return { status: response.status, body: await response.json() }
}

describe("task wiring through the real app", () => {
  it("is reachable under /api and starts empty", async () => {
    const listed = await get("/api/tasks")
    expect(listed.status).toBe(200)
    expect(listed.body).toMatchObject({ tasks: [], total: 0 })

    // 没挂到 /api 前缀上就会落到前端路由，这里必须是 JSON 404
    const missing = await get("/api/tasks/nope")
    expect(missing.status).toBe(404)
    expect(missing.body.message).toContain("没有找到")

    const notApi = await fetch(`${baseUrl}/tasks`)
    expect(notApi.headers.get("content-type") ?? "").not.toContain(
      "application/json"
    )
  })

  it("refuses a write without a request id instead of running it", async () => {
    const response = await fetch(`${baseUrl}/api/disk-growth/scan`, {
      method: "POST",
    })
    expect(response.status).toBe(400)
    // 校验失败发生任何副作用之前：不会派发任务
    expect(dispatched).toHaveLength(0)
  })

  it("accepts a scan, exposes it while running, and reports the real result", async () => {
    const requestId = `req_${"i".repeat(16)}`
    const started = await fetch(`${baseUrl}/api/disk-growth/scan`, {
      method: "POST",
      headers: { [TASK_REQUEST_ID_HEADER]: requestId },
    })
    // 执行器不结束 -> 走受理分支
    expect(started.status).toBe(202)
    const accepted = await started.json()
    expect(accepted).toMatchObject({ kind: "disk_scan", status: "running" })
    expect(dispatched).toHaveLength(1)

    const running = await get(`/api/tasks/${accepted.taskId}`)
    expect(running.status).toBe(200)
    expect(running.body).toMatchObject({ status: "running", kind: "disk_scan" })

    const active = await get("/api/tasks")
    expect(active.body.tasks.map((task: { id: string }) => task.id)).toEqual([
      accepted.taskId,
    ])

    dispatched[0].resolve({
      result: { snapshotId: 5, fileCount: 9, dirCount: 2, totalSize: 4096 },
      message: "已完成",
      status: "done",
    })
    await new Promise((resolve) => setTimeout(resolve, 30))

    const done = await get(`/api/tasks/${accepted.taskId}`)
    expect(done.body).toMatchObject({
      status: "done",
      result: { snapshotId: 5, fileCount: 9, dirCount: 2, totalSize: 4096 },
    })
    // 终结后不再出现在进行中列表里
    expect((await get("/api/tasks")).body.tasks).toEqual([])
  })

  it("does not run the same request twice", async () => {
    const requestId = `req_${"j".repeat(16)}`
    const headers = { [TASK_REQUEST_ID_HEADER]: requestId }
    const first = await fetch(`${baseUrl}/api/disk-growth/scan`, {
      method: "POST",
      headers,
    })
    const second = await fetch(`${baseUrl}/api/disk-growth/scan`, {
      method: "POST",
      headers,
    })
    expect((await first.json()).taskId).toBe((await second.json()).taskId)
    expect(dispatched).toHaveLength(1)
    dispatched[0].resolve({
      result: { snapshotId: 6, fileCount: 1, dirCount: 1, totalSize: 1 },
      message: null,
      status: "done",
    })
  })
})
