import { mkdtempSync, rmSync } from "node:fs"
import type { Server } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { createApp } from "@server/app"
import { TaskStore } from "@server/common/tasks/store"
import {
  TaskHostError,
  type TaskOutcome,
} from "@server/common/tasks/worker-host"
import { getAuthPassword } from "@server/env"
import {
  TASK_KINDS,
  TASK_REQUEST_ID_HEADER,
  TaskRecordSchema,
} from "@shared/api-contract"
import { ApiPath } from "@shared/api-path"
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
let dispatched: {
  taskId: string
  resolve: (outcome: TaskOutcome) => void
  reject: (error: unknown) => void
}[]
let failImmediately = false
let completeImmediately = false
let unknownImmediately = false

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-integration-"))
  store = new TaskStore(path.join(dir, "tasks.sqlite3"))
  dispatched = []
  failImmediately = false
  completeImmediately = false
  unknownImmediately = false
  runtime = createTaskRuntime({
    store,
    recoverInterrupted: false,
    // 用很短的阈值跑测试，避免每个用例都等默认的 5 秒。
    thresholdMs: 30,
    host: {
      execute: (job) =>
        new Promise<TaskOutcome>((resolve, reject) => {
          dispatched.push({ taskId: job.taskId, resolve, reject })
          if (completeImmediately)
            resolve({
              result: { message: "已创建" },
              message: "已创建",
              status: "done",
            })
          if (failImmediately) {
            reject(new TaskHostError("unknown", "执行进程退出，结果未知"))
          }
          if (unknownImmediately) {
            resolve({
              result: {
                snapshotId: 1,
                fileCount: 0,
                dirCount: 0,
                totalSize: 0,
              },
              message: "测速未能确认",
              error: "测速超时，结果未知",
              status: "unknown",
            })
          }
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

/**
 * 认证是 fail-closed 的：这些请求要过真实中间件，必须带访问密码。
 * 密码仍取自 .env（与生产同源），不硬编码。
 */
const authHeaders = (
  extra: Record<string, string> = {}
): Record<string, string> => ({
  authorization: `Bearer ${getAuthPassword()}`,
  ...extra,
})

const get = async (url: string) => {
  const response = await fetch(`${baseUrl}${url}`, { headers: authHeaders() })
  return { status: response.status, body: await response.json() }
}

describe("task wiring through the real app", () => {
  it.each([
    {
      kind: TASK_KINDS.fileCopy,
      url: ApiPath.filesEntriesCopy,
      method: "POST",
      body: { paths: ["/tmp/audit"], destPath: "/tmp/dest" },
      result: { completed: ["/tmp/audit"], failed: [], skipped: [], bytes: 1 },
    },
    {
      kind: TASK_KINDS.fileMove,
      url: ApiPath.filesEntriesMove,
      method: "POST",
      body: { paths: ["/tmp/audit"], destPath: "/tmp/dest" },
      result: { completed: ["/tmp/audit"], failed: [], skipped: [], bytes: 1 },
    },
    {
      kind: TASK_KINDS.fileDelete,
      url: `${ApiPath.filesEntries}?paths[0]=%2Ftmp%2Faudit`,
      method: "DELETE",
      body: undefined,
      result: {
        completed: ["/tmp/audit"],
        failed: [],
        skipped: [],
        bytes: null,
      },
    },
    {
      kind: TASK_KINDS.diskSnapshotDelete,
      url: `${ApiPath.diskGrowthScans}?scanIds=1`,
      method: "DELETE",
      body: undefined,
      result: { removed: 1 },
    },
    {
      kind: TASK_KINDS.trafficSnapshotSave,
      url: ApiPath.trafficSnapshots,
      method: "POST",
      body: undefined,
      result: { snapshotId: "audit", rangeText: "审计区间" },
    },
    {
      kind: TASK_KINDS.trafficSnapshotMerge,
      url: ApiPath.trafficSnapshotsMerge,
      method: "PUT",
      body: { ids: ["a", "b"] },
      result: { snapshotIds: ["audit"] },
    },
    {
      kind: TASK_KINDS.trafficSnapshotDelete,
      url: `${ApiPath.trafficSnapshots}?ids=a`,
      method: "DELETE",
      body: undefined,
      result: { snapshotIds: [] },
    },
    {
      kind: TASK_KINDS.fileCreate,
      url: ApiPath.filesEntries,
      method: "POST",
      body: { parentPath: "/tmp", name: "audit.txt" },
    },
    {
      kind: TASK_KINDS.fileRename,
      url: ApiPath.filesEntryName,
      method: "PUT",
      body: { path: "/tmp/audit.txt", name: "renamed.txt" },
    },
    {
      kind: TASK_KINDS.fileWriteContent,
      url: ApiPath.filesContent,
      method: "PUT",
      body: { path: "/tmp/audit.txt", content: "audit" },
    },
    {
      kind: TASK_KINDS.frpConfigSave,
      url: ApiPath.frpConfig,
      method: "PUT",
      body: {
        server: {
          serverAddr: "example.test",
          serverPort: 7000,
          authMethod: "token",
          authToken: "test",
        },
        proxies: [],
      },
    },
    {
      kind: TASK_KINDS.serviceAction,
      url: ApiPath.systemServicesRestart,
      method: "POST",
      body: { label: "com.example.audit", domain: "user" },
    },
    {
      kind: TASK_KINDS.diskEntryReveal,
      url: ApiPath.diskGrowthReveal,
      method: "POST",
      body: { path: "/tmp/audit" },
    },
    {
      kind: TASK_KINDS.diskEntryTrash,
      url: `${ApiPath.diskGrowthEntry}?path=${encodeURIComponent("/tmp/audit")}`,
      method: "DELETE",
      body: undefined,
    },
  ])("exposes accepted and completed $kind actions", async (action) => {
    const requestId = `req_${action.kind}_audit`
    const send = (identified: boolean) =>
      fetch(`${baseUrl}${action.url}`, {
        method: action.method,
        headers: authHeaders({
          ...(identified ? { [TASK_REQUEST_ID_HEADER]: requestId } : {}),
          "content-type": "application/json",
        }),
        body: action.body ? JSON.stringify(action.body) : undefined,
      })
    expect((await send(false)).status).toBe(400)
    expect(dispatched).toHaveLength(0)
    const response = await send(true)
    expect(response.status).toBe(202)
    const accepted = await response.json()
    expect(accepted.kind).toBe(action.kind)
    const replay = await send(true)
    expect(replay.status).toBe(202)
    expect((await replay.json()).taskId).toBe(accepted.taskId)
    expect(dispatched).toHaveLength(1)
    if (action.body) {
      const different = await fetch(`${baseUrl}${action.url}`, {
        method: action.method,
        headers: authHeaders({
          [TASK_REQUEST_ID_HEADER]: requestId,
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          ...action.body,
          ...("name" in action.body
            ? { name: "changed.txt" }
            : "path" in action.body
              ? { path: "/tmp/changed" }
              : "label" in action.body
                ? { label: "com.example.changed" }
                : "ids" in action.body
                  ? { ids: ["changed", "other"] }
                  : "paths" in action.body
                    ? { paths: ["/tmp/changed"] }
                    : {
                        proxies: [
                          {
                            name: "changed",
                            type: "tcp",
                            localIP: "127.0.0.1",
                            localPort: 1,
                            remotePort: 2,
                          },
                        ],
                      }),
        }),
      })
      expect(different.status).toBe(409)
      expect(dispatched).toHaveLength(1)
    }
    const conflict = await fetch(`${baseUrl}${action.url}`, {
      method: action.method,
      headers: authHeaders({
        [TASK_REQUEST_ID_HEADER]: `${requestId}_other`,
        "content-type": "application/json",
      }),
      body: action.body ? JSON.stringify(action.body) : undefined,
    })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({
      executionStatus: "not_started",
    })
    expect(dispatched).toHaveLength(1)

    const active = await get(ApiPath.tasks)
    expect(active.body.total).toBe(1)
    expect(active.body.tasks).toHaveLength(1)
    const running = await get(`${ApiPath.tasks}/${accepted.taskId}`)
    expect(running.status).toBe(200)
    expect(TaskRecordSchema.parse(running.body).status).toBe("running")
    const byRequest = await get(
      `${ApiPath.tasks}?status=all&requestId=${requestId}`
    )
    expect(byRequest.body.tasks[0].id).toBe(accepted.taskId)

    const result =
      "result" in action ? action.result : { message: "动作已完成" }
    dispatched[0].resolve({
      result,
      message: "动作已完成",
      status: "done",
    })
    await expect.poll(() => store.get(accepted.taskId)?.status).toBe("done")
    const done = await get(`${ApiPath.tasks}/${accepted.taskId}`)
    expect(done.status).toBe(200)
    expect(TaskRecordSchema.parse(done.body)).toMatchObject({
      kind: action.kind,
      status: "done",
      result,
    })
    expect((await get(ApiPath.tasks)).body.tasks).toEqual([])
    const history = await get(
      `${ApiPath.tasks}?status=all&requestId=${requestId}`
    )
    expect(history.body.total).toBe(1)
    expect(history.body.tasks).toHaveLength(1)
    expect(history.body.tasks[0].status).toBe("done")
    const completedReplay = await send(true)
    expect([200, 201]).toContain(completedReplay.status)
    expect(await completedReplay.json()).toEqual(result)
    expect(dispatched).toHaveLength(1)
  })

  it("keeps a fast unknown result queryable without replaying execution", async () => {
    failImmediately = true
    const requestId = "req_fast_unknown_audit"
    const send = () =>
      fetch(`${baseUrl}${ApiPath.diskGrowthScan}`, {
        method: "POST",
        headers: authHeaders({ [TASK_REQUEST_ID_HEADER]: requestId }),
      })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await send()
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({
        executionStatus: "unknown",
      })
    }
    expect(dispatched).toHaveLength(1)
    const record = await get(
      `${ApiPath.tasks}?status=all&requestId=${requestId}`
    )
    expect(record.body.tasks[0].status).toBe("unknown")

    const conflict = await fetch(`${baseUrl}${ApiPath.diskGrowthReveal}`, {
      method: "POST",
      headers: authHeaders({
        [TASK_REQUEST_ID_HEADER]: requestId,
        "content-type": "application/json",
      }),
      body: JSON.stringify({ path: "/tmp/audit" }),
    })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({
      executionStatus: "not_started",
    })
    expect(dispatched).toHaveLength(1)
  })

  it("persists a declared unknown outcome and exposes it through task reads", async () => {
    unknownImmediately = true
    const requestId = "req_declared_unknown_http"
    const response = await fetch(`${baseUrl}${ApiPath.diskGrowthScan}`, {
      method: "POST",
      headers: authHeaders({ [TASK_REQUEST_ID_HEADER]: requestId }),
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      executionStatus: "unknown",
      message: "测速超时，结果未知",
    })
    expect(dispatched).toHaveLength(1)

    const history = await get(
      `${ApiPath.tasks}?status=all&requestId=${requestId}`
    )
    const taskId = history.body.tasks[0].id
    expect(history.body.tasks[0]).toMatchObject({
      status: "unknown",
      message: "测速未能确认",
      error: "测速超时，结果未知",
      result: { snapshotId: 1, fileCount: 0, dirCount: 0, totalSize: 0 },
    })
    const task = await get(`${ApiPath.tasks}/${taskId}`)
    expect(task.body).toMatchObject({
      status: "unknown",
      error: "测速超时，结果未知",
    })

    const replay = await fetch(`${baseUrl}${ApiPath.diskGrowthScan}`, {
      method: "POST",
      headers: authHeaders({ [TASK_REQUEST_ID_HEADER]: requestId }),
    })
    expect(replay.status).toBe(409)
    expect(await replay.json()).toMatchObject({ executionStatus: "unknown" })
    expect(dispatched).toHaveLength(1)
  })

  it("returns a quick completed action without an accepted receipt", async () => {
    completeImmediately = true
    const submission = fetch(`${baseUrl}${ApiPath.filesEntries}`, {
      method: "POST",
      headers: authHeaders({
        [TASK_REQUEST_ID_HEADER]: "req_fast_completed_audit",
        "content-type": "application/json",
      }),
      body: JSON.stringify({ parentPath: "/tmp", name: "audit.txt" }),
    })
    const response = await submission
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ message: "已创建" })
    expect(dispatched).toHaveLength(1)
  })

  it("is reachable under /api and starts empty", async () => {
    const listed = await get("/api/tasks")
    expect(listed.status).toBe(200)
    expect(listed.body).toMatchObject({ tasks: [], total: 0 })

    // 没挂到 /api 前缀上就会落到前端路由，这里必须是 JSON 404
    const missing = await get("/api/tasks/nope")
    expect(missing.status).toBe(404)
    expect(missing.body.message).toContain("没有找到")

    const notApi = await fetch(`${baseUrl}/tasks`, { headers: authHeaders() })
    expect(notApi.headers.get("content-type") ?? "").not.toContain(
      "application/json"
    )
  })

  it("refuses a write without a request id instead of running it", async () => {
    const response = await fetch(`${baseUrl}/api/disk-growth/scan`, {
      method: "POST",
      headers: authHeaders(),
    })
    expect(response.status).toBe(400)
    // 校验失败发生任何副作用之前：不会派发任务
    expect(dispatched).toHaveLength(0)
  })

  it("accepts a scan, exposes it while running, and reports the real result", async () => {
    const requestId = `req_${"i".repeat(16)}`
    const started = await fetch(`${baseUrl}/api/disk-growth/scan`, {
      method: "POST",
      headers: authHeaders({ [TASK_REQUEST_ID_HEADER]: requestId }),
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
    const headers = authHeaders({ [TASK_REQUEST_ID_HEADER]: requestId })
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
