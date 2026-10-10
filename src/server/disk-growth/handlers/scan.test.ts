import { mkdtempSync, rmSync } from "node:fs"
import type { Server } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { TaskRunner } from "@server/common/tasks/runner"
import { TaskStore } from "@server/common/tasks/store"
import type {
  TaskJob,
  TaskOutcome,
  TaskRunContext,
} from "@server/common/tasks/worker-host"
import { TASK_REQUEST_ID_HEADER } from "@shared/api-contract"
import { createExpressEndpoints } from "@ts-rest/express"
import express from "express"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { scanTaskTarget } from "../task"
import { createDiskGrowthRouter, diskGrowthContract } from "."

const scanResult = {
  snapshotId: 7,
  fileCount: 12,
  dirCount: 3,
  totalSize: 4096,
}

type Call = {
  job: TaskJob
  context: TaskRunContext
  resolve: (outcome: TaskOutcome) => void
  reject: (error: unknown) => void
}

let dir: string
let store: TaskStore
let server: Server
let baseUrl: string
let calls: Call[]

const THRESHOLD_MS = 40

const post = async (headers: Record<string, string> = {}) => {
  const response = await fetch(`${baseUrl}/api/disk-growth/scan`, {
    method: "POST",
    headers,
  })
  return { status: response.status, body: await response.json() }
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-scan-http-"))
  store = new TaskStore(path.join(dir, "tasks.sqlite3"))
  calls = []
  const runner = new TaskRunner({
    store,
    thresholdMs: THRESHOLD_MS,
    host: {
      execute: (job, context) =>
        new Promise<TaskOutcome>((resolve, reject) => {
          calls.push({ job, context, resolve, reject })
        }),
    },
  })
  const app = express()
  createExpressEndpoints(
    diskGrowthContract,
    createDiskGrowthRouter({ runner, store }),
    app,
    { logInitialization: false }
  )
  server = app.listen(0)
  await new Promise((resolve) => server.once("listening", resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${
    typeof address === "object" && address ? address.port : 0
  }`
})

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve))
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

const requestId = (suffix: string) => `req_${suffix.padStart(16, "0")}`

describe("POST /api/disk-growth/scan", () => {
  it("requires a request id so a resend cannot become a second scan", async () => {
    const missing = await post()
    expect(missing.status).toBe(400)

    const malformed = await post({ [TASK_REQUEST_ID_HEADER]: "short" })
    expect(malformed.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it("returns the created snapshot when the scan finishes inside the threshold", async () => {
    const submission = post({ [TASK_REQUEST_ID_HEADER]: requestId("fast") })
    while (calls.length === 0) await new Promise((r) => setTimeout(r, 2))
    calls[0].resolve({ result: scanResult, message: "完成", status: "done" })

    const response = await submission
    expect(response.status).toBe(201)
    expect(response.body).toMatchObject(scanResult)
    expect(calls[0].job).toMatchObject({
      kind: "disk_scan",
      target: scanTaskTarget("/"),
      payload: { root: "/" },
    })
  })

  it("returns a task reference when the scan is still running", async () => {
    const response = await post({
      [TASK_REQUEST_ID_HEADER]: requestId("slow"),
    })
    expect(response.status).toBe(202)
    expect(response.body).toMatchObject({
      kind: "disk_scan",
      status: "running",
    })
    expect(typeof response.body.taskId).toBe("string")
    expect(store.get(response.body.taskId)?.status).toBe("running")
    expect(store.get(response.body.taskId)?.requestId).toBe(requestId("slow"))
    calls[0].resolve({ result: scanResult, message: "完成", status: "done" })
  })

  it("reuses the same task for a repeated request id instead of scanning twice", async () => {
    const first = await post({ [TASK_REQUEST_ID_HEADER]: requestId("retry") })
    const second = await post({ [TASK_REQUEST_ID_HEADER]: requestId("retry") })
    expect(first.status).toBe(202)
    expect(second).toMatchObject({
      status: 202,
      body: { taskId: first.body.taskId },
    })
    expect(calls).toHaveLength(1)
    calls[0].resolve({ result: scanResult, message: "完成", status: "done" })
  })

  it("refuses a different request while the same target is busy", async () => {
    await post({ [TASK_REQUEST_ID_HEADER]: requestId("busy-a") })
    const conflict = await post({
      [TASK_REQUEST_ID_HEADER]: requestId("busy-b"),
    })
    expect(conflict.status).toBe(409)
    expect(conflict.body.message).toContain("已有任务在执行")
    expect(calls).toHaveLength(1)
    calls[0].resolve({ result: scanResult, message: "完成", status: "done" })
  })

  it("reports a real failure as a server error, not as success", async () => {
    const submission = post({ [TASK_REQUEST_ID_HEADER]: requestId("fail") })
    while (calls.length === 0) await new Promise((r) => setTimeout(r, 2))
    calls[0].reject(new Error("未找到 fd 可执行文件，请先安装 fd"))

    const response = await submission
    expect(response.status).toBe(500)
    expect(response.body.message).toContain("未找到 fd")
  })

  it("rejects a completion result that does not match the contract", async () => {
    const submission = post({ [TASK_REQUEST_ID_HEADER]: requestId("shape") })
    while (calls.length === 0) await new Promise((r) => setTimeout(r, 2))
    calls[0].resolve({ result: { ok: true }, message: null, status: "done" })

    const response = await submission
    expect(response.status).toBe(500)
    expect(response.body.message).toContain("不符合契约")
  })
})
