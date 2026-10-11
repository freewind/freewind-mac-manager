import { mkdtempSync, rmSync } from "node:fs"
import type { Server } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { createExpressEndpoints } from "@ts-rest/express"
import express from "express"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { TaskStore } from "../common/tasks/store"
import { createTasksRouter, tasksContract } from "./handlers"

let dir: string
let store: TaskStore
let server: Server
let baseUrl: string

const get = async (url: string) => {
  const response = await fetch(`${baseUrl}${url}`)
  return { status: response.status, body: await response.json() }
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-task-http-"))
  store = new TaskStore(path.join(dir, "tasks.sqlite3"))
  const app = express()
  // 只挂任务路由：鉴权由 app.ts 统一负责，这里验证查询行为本身。
  createExpressEndpoints(tasksContract, createTasksRouter(store), app, {
    logInitialization: false,
  })
  server = app.listen(0)
  await new Promise((resolve) => server.once("listening", resolve))
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve))
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

const seedRunning = (id: string, target = "/tmp/a") =>
  store.insert({
    id,
    requestId: `req-${id}`,
    requestFingerprint: "fp",
    kind: "file_delete",
    target,
    startedAt: 1000,
  })

describe("task query endpoints", () => {
  it("lists running tasks by default", async () => {
    seedRunning("t1")
    store.insert({
      id: "t2",
      requestId: "req-t2",
      requestFingerprint: "fp",
      kind: "disk_scan",
      target: "scan:/",
      startedAt: 1001,
    })
    store.finish("t2", {
      status: "done",
      result: { snapshotId: 4, fileCount: 1, dirCount: 1, totalSize: 2 },
      message: "完成",
      error: null,
      finishedAt: 1002,
    })

    const active = await get("/api/tasks")
    expect(active.status).toBe(200)
    expect(active.body.tasks.map((task: { id: string }) => task.id)).toEqual([
      "t1",
    ])

    const all = await get("/api/tasks?status=all")
    expect(all.body.total).toBe(2)
    expect(
      all.body.tasks.find((task: { id: string }) => task.id === "t2").result
    ).toEqual({ snapshotId: 4, fileCount: 1, dirCount: 1, totalSize: 2 })
  })

  it("filters by kind and ignores malformed kind input", async () => {
    seedRunning("t1")
    store.insert({
      id: "t2",
      requestId: "req-t2",
      requestFingerprint: "fp",
      kind: "disk_scan",
      target: "scan:/",
      startedAt: 1001,
    })
    const byKind = await get("/api/tasks?status=all&kinds=disk_scan")
    expect(byKind.body.tasks.map((task: { id: string }) => task.id)).toEqual([
      "t2",
    ])
    const injected = await get(
      "/api/tasks?status=all&kinds=disk_scan%27%20OR%201%3D1--"
    )
    expect(injected.status).toBe(200)
    expect(injected.body.tasks).toEqual([])
  })

  it("looks a task up by id and reports 404 for an unknown one", async () => {
    seedRunning("t1")
    const found = await get("/api/tasks/t1")
    expect(found.status).toBe(200)
    expect(found.body).toMatchObject({
      id: "t1",
      kind: "file_delete",
      status: "running",
    })

    const missing = await get("/api/tasks/nope")
    expect(missing.status).toBe(404)
    // 没有记录只说明查不到，不能推断该操作没有执行过
    expect(missing.body.message).toContain("没有找到")
  })

  it("returns only the documented task fields", async () => {
    seedRunning("t1")
    const listed = await get("/api/tasks?status=all")
    const [task] = listed.body.tasks
    // 载荷从不入库，也不出现在响应里；记录只带已约定的字段。
    expect(Object.keys(task).sort()).toEqual([
      "error",
      "finishedAt",
      "id",
      "kind",
      "message",
      "progress",
      "requestId",
      "result",
      "startedAt",
      "status",
      "target",
      "updatedAt",
    ])
    expect(JSON.stringify(listed.body)).not.toContain("secret-token")
  })

  it("skips records that no longer satisfy the contract", async () => {
    seedRunning("t1")
    store.insert({
      id: "broken",
      requestId: "req-broken",
      requestFingerprint: "fp",
      kind: "file_delete",
      target: "/tmp/broken",
      startedAt: 1001,
    })
    store.finish("broken", {
      status: "done",
      result: { completed: "not-an-array" },
      message: null,
      error: null,
      finishedAt: 1002,
    })

    const listed = await get("/api/tasks?status=all")
    expect(listed.body.tasks.map((task: { id: string }) => task.id)).toEqual([
      "t1",
    ])
    expect((await get("/api/tasks/broken")).status).toBe(404)
  })

  it("pages results", async () => {
    for (let index = 0; index < 3; index += 1) {
      seedRunning(`t${index}`, `/tmp/${index}`)
    }
    const page = await get("/api/tasks?page=2&pageSize=1")
    expect(page.body).toMatchObject({ page: 2, pageSize: 1, total: 3 })
    expect(page.body.tasks).toHaveLength(1)
  })
})
