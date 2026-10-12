import { rmSync } from "node:fs"
import type { Server } from "node:http"
import express from "express"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { sessionApi, streamMock } = vi.hoisted(() => ({
  sessionApi: {
    createSession: vi.fn(),
    getSession: vi.fn(),
    beginSessionRun: vi.fn(),
    endSessionRun: vi.fn(),
    disposeSession: vi.fn(),
  },
  streamMock: vi.fn(),
}))

/** 测试库路径：函数声明会被提升，mock 工厂里也能安全调用。 */
function testDbFile(): string {
  return `${process.env.TMPDIR ?? "/tmp"}/ai-assistant-handlers-test-${process.pid}.sqlite3`
}

// @server/env 在 import 时就把 DATABASE_FILE 算好了，必须在这里换成临时库，
// 否则任何一个读都会落到真实 data/snapshots.sqlite3 上。
vi.mock("@server/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@server/env")>()),
  DATABASE_FILE: testDbFile(),
}))
// 只替身会话与流：端点接线（锁、状态码、释放）由这里驱动。
vi.mock("./session", () => sessionApi)
vi.mock("./stream", () => ({ streamSession: streamMock }))
vi.mock("./config", () => ({
  getAiAssistantSettings: () => ({
    settings: {},
    signature: "s",
    updatedAt: 1,
  }),
  saveAiAssistantSettings: vi.fn(),
}))

import { createExpressEndpoints } from "@ts-rest/express"
import {
  aiAssistantContract,
  createAiAssistantRouter,
  registerAiAssistantStreamEndpoint,
} from "./handlers"

let server: Server
let baseUrl = ""

const start = async (): Promise<void> => {
  const app = express()
  app.use(express.json())
  // 同一份 app 上挂两类端点：SSE 与契约里的删除端点。
  createExpressEndpoints(aiAssistantContract, createAiAssistantRouter(), app, {
    logInitialization: false,
  })
  registerAiAssistantStreamEndpoint(app)
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening))
  })
  const address = server.address()
  if (address === null || typeof address === "string") {
    throw new Error("测试服务器没有拿到端口")
  }
  baseUrl = `http://127.0.0.1:${address.port}`
}

const post = (body: unknown) =>
  fetch(`${baseUrl}/api/ai-assistant/sessions/:sessionId/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

beforeEach(async () => {
  rmSync(testDbFile(), { force: true })
  rmSync(`${testDbFile()}-wal`, { force: true })
  rmSync(`${testDbFile()}-shm`, { force: true })
  for (const fn of Object.values(sessionApi)) fn.mockReset()
  streamMock.mockReset()
  sessionApi.getSession.mockReturnValue({ kind: "fake-session" })
  sessionApi.beginSessionRun.mockReturnValue(true)
  // 正常的流会自己收尾响应；替身也要 end，否则请求会挂住。
  streamMock.mockImplementation((...args: unknown[]) => {
    const response = args[3] as { end: () => void }
    response.end()
    return Promise.resolve()
  })
  await start()
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(testDbFile(), { force: true })
  rmSync(`${testDbFile()}-wal`, { force: true })
  rmSync(`${testDbFile()}-shm`, { force: true })
})

describe("SSE 端点的并发保护", () => {
  it("同一会话已有在途运行时用 409 拒绝，不进入 SSE", async () => {
    sessionApi.beginSessionRun.mockReturnValue(false)

    const response = await post({ sessionId: "s-1", prompt: "再来一次" })

    expect(response.status).toBe(409)
    const body = (await response.json()) as {
      message: string
      executionStatus?: string
    }
    expect(body.message).toContain("正在执行")
    // 明确告知没有开始执行，也不会改写第一个 run 的状态。
    expect(body.executionStatus).toBe("not_started")
    expect(streamMock).not.toHaveBeenCalled()
  })

  it("进入 SSE 时持有锁，结束后在 finally 释放", async () => {
    await post({ sessionId: "s-1", prompt: "第一次" })

    expect(sessionApi.beginSessionRun).toHaveBeenCalledWith("s-1")
    expect(streamMock).toHaveBeenCalledTimes(1)
    expect(sessionApi.endSessionRun).toHaveBeenCalledWith("s-1")
  })

  it("streamSession 抛错也会释放锁", async () => {
    streamMock.mockRejectedValue(new Error("上游炸了"))

    const response = await post({ sessionId: "s-1", prompt: "第一次" })

    // headersSent 为 false：仍按普通错误返回，且锁必须已释放。
    expect(response.status).toBe(500)
    expect(sessionApi.endSessionRun).toHaveBeenCalledWith("s-1")
  })
})

describe("清空会话的接线", () => {
  it("执行中的会话返回 409，且不会丢掉内存会话", async () => {
    const store = await import("./store")
    store.saveSession({ id: "running-1", settingsSnapshot: {} })
    store.startSessionRun("running-1", { role: "user", text: "问" })

    const response = await fetch(
      `${baseUrl}/api/ai-assistant/sessions/running-1`,
      { method: "DELETE" }
    )

    expect(response.status).toBe(409)
    expect(sessionApi.disposeSession).not.toHaveBeenCalled()
    expect(store.readSession("running-1").status).toBe("running")
  })

  it("空闲会话清空成功，并丢弃内存会话", async () => {
    const store = await import("./store")
    store.saveSession({ id: "idle-1", settingsSnapshot: {} })

    const response = await fetch(
      `${baseUrl}/api/ai-assistant/sessions/idle-1`,
      {
        method: "DELETE",
      }
    )

    expect(response.status).toBe(204)
    expect(sessionApi.disposeSession).toHaveBeenCalledWith("idle-1")
    expect(() => store.readSession("idle-1")).toThrow("会话不存在")
  })
})
