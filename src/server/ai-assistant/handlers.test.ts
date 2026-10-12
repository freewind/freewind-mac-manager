import { rmSync } from "node:fs"
import type { Server } from "node:http"
import express from "express"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

/** 受控会话替身：端点接线（锁、状态码、响应头、停止）由这里驱动。 */
const fake = {
  aborted: false,
  answer: undefined as string | undefined,
  run: async (_text: string): Promise<void> => {},
}
const listeners: Array<(event: unknown) => void> = []
const fakeSession = {
  subscribe: (listener: (event: unknown) => void) => {
    listeners.push(listener)
    return () => {
      const index = listeners.indexOf(listener)
      if (index >= 0) listeners.splice(index, 1)
    }
  },
  prompt: (text: string) => fake.run(text),
  abort: () => {
    fake.aborted = true
  },
  getLastAssistantText: () => fake.answer,
}

// 只替身会话的创建/查找/丢弃；在途锁与 dispose 通知保持真实，
// 因为执行的生命周期归 runner，端点不再自己管锁。
vi.mock("./session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session")>()),
  createSession: vi.fn(),
  getSession: vi.fn(() => fakeSession),
  disposeSession: vi.fn(),
}))
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
  // 同一份 app 上挂两类端点：SSE 与契约里的查询/停止/删除端点。
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

const post = (body: unknown, requestId?: string) =>
  fetch(`${baseUrl}/api/ai-assistant/sessions/:sessionId/message`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(requestId ? { "x-task-request-id": requestId } : {}),
    },
    body: JSON.stringify(body),
  })

/** 执行标识从响应头取；缺了就是接线坏了，直接失败。 */
const executionIdOf = (response: Response): string => {
  const executionId = response.headers.get("x-ai-assistant-execution-id")
  if (!executionId) throw new Error("响应缺少执行标识头")
  return executionId
}

const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let index = 0; index < 200; index += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error("等待条件成立超时")
}

const fetchExecution = async (executionId: string) => {
  const response = await fetch(
    `${baseUrl}/api/ai-assistant/executions/${executionId}`
  )
  expect(response.status).toBe(200)
  return (await response.json()) as {
    execution: { status: string; cancelled: boolean }
  }
}

/** 轮询到执行进入指定终态；执行是后台跑的，不能假定同步完成。 */
const waitForStatus = async (executionId: string, status: string) => {
  for (let index = 0; index < 200; index += 1) {
    const body = await fetchExecution(executionId)
    if (body.execution.status === status) return body
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`等待执行进入 ${status} 超时`)
}

beforeEach(async () => {
  rmSync(testDbFile(), { force: true })
  rmSync(`${testDbFile()}-wal`, { force: true })
  rmSync(`${testDbFile()}-shm`, { force: true })
  fake.aborted = false
  fake.answer = undefined
  fake.run = async () => {}
  listeners.length = 0
  await start()
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(testDbFile(), { force: true })
  rmSync(`${testDbFile()}-wal`, { force: true })
  rmSync(`${testDbFile()}-shm`, { force: true })
})

describe("提交执行的接线", () => {
  it("回传会话标识与执行标识响应头，并能按执行标识查到状态", async () => {
    const store = await import("./store")
    store.saveSession({ id: "hdr-1", settingsSnapshot: {} })
    fake.run = async () => {
      fake.answer = "答"
    }

    const response = await post({ sessionId: "hdr-1", prompt: "你好" })
    expect(response.status).toBe(200)
    expect(response.headers.get("x-ai-assistant-session-id")).toBe("hdr-1")
    const executionId = executionIdOf(response)
    expect(executionId).toMatch(/^exec-/)
    await response.text()

    const status = await fetch(
      `${baseUrl}/api/ai-assistant/executions/${executionId}`
    )
    expect(status.status).toBe(200)
    const body = (await status.json()) as {
      execution: { status: string; answer: string | null }
      messages: unknown[]
    }
    expect(body.execution.status).toBe("done")
    expect(body.execution.answer).toBe("答")
    expect(body.messages).toEqual([
      { role: "user", text: "你好" },
      { role: "assistant", text: "答" },
    ])
  })

  it("同一会话已有在途运行时用 409 拒绝，且明确没有开始执行", async () => {
    const store = await import("./store")
    const sessionApi = await import("./session")
    store.saveSession({ id: "busy-1", settingsSnapshot: {} })
    let release: () => void = () => {}
    fake.run = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })

    const first = post({ sessionId: "busy-1", prompt: "第一次" })
    await waitFor(() => sessionApi.isSessionRunning("busy-1"))

    const response = await post({ sessionId: "busy-1", prompt: "再来一次" })
    expect(response.status).toBe(409)
    const body = (await response.json()) as {
      message: string
      executionStatus?: string
    }
    expect(body.message).toContain("正在执行")
    // 明确告知没有开始执行，也不会改写第一个 run 的状态。
    expect(body.executionStatus).toBe("not_started")
    expect(store.readSession("busy-1").messages).toEqual([
      { role: "user", text: "第一次" },
    ])

    release()
    await (await first).text()
  })

  it("同一请求标识重复提交复用同一执行，不产生第二次副作用", async () => {
    const store = await import("./store")
    store.saveSession({ id: "idem-1", settingsSnapshot: {} })
    let promptCalls = 0
    fake.run = async () => {
      promptCalls += 1
      fake.answer = "答"
    }
    const requestId = "req-0000000000000003"

    const first = await post({ sessionId: "idem-1", prompt: "你好" }, requestId)
    const firstExecution = first.headers.get("x-ai-assistant-execution-id")
    await first.text()

    const second = await post(
      { sessionId: "idem-1", prompt: "你好" },
      requestId
    )
    expect(second.headers.get("x-ai-assistant-execution-id")).toBe(
      firstExecution
    )
    await second.text()

    expect(promptCalls).toBe(1)
    expect(store.readSession("idem-1").messages).toEqual([
      { role: "user", text: "你好" },
      { role: "assistant", text: "答" },
    ])
  })

  it("同一请求标识重放不新建会话，也不产生第二次副作用", async () => {
    const store = await import("./store")
    const sessionApi = await import("./session")
    const createSession = vi.mocked(sessionApi.createSession)
    createSession.mockResolvedValue({
      sessionId: "new-1",
      session: fakeSession,
    } as never)
    store.saveSession({ id: "new-1", settingsSnapshot: {} })
    let promptCalls = 0
    fake.run = async () => {
      promptCalls += 1
      fake.answer = "答"
    }
    const requestId = "req-0000000000000004"

    // 不传 sessionId：第一次要新建会话，重放必须复用它，不能再建一个
    const first = await post({ prompt: "你好" }, requestId)
    expect(first.headers.get("x-ai-assistant-session-id")).toBe("new-1")
    await first.text()

    const second = await post({ prompt: "你好" }, requestId)
    expect(second.headers.get("x-ai-assistant-session-id")).toBe("new-1")
    await second.text()

    expect(createSession).toHaveBeenCalledTimes(1)
    expect(promptCalls).toBe(1)
  })

  it("断线只退订，显式停止才取消执行", async () => {
    const store = await import("./store")
    store.saveSession({ id: "stop-1", settingsSnapshot: {} })
    let release: () => void = () => {}
    fake.run = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })

    const controller = new AbortController()
    const response = await fetch(
      `${baseUrl}/api/ai-assistant/sessions/:sessionId/message`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "stop-1", prompt: "你好" }),
        signal: controller.signal,
      }
    )
    const executionId = executionIdOf(response)
    expect(executionId).toBeTruthy()

    // 断线：只解除订阅，不中止执行（响应头已到，说明执行已经开始）
    controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(fake.aborted).toBe(false)
    expect((await fetchExecution(executionId)).execution.status).toBe("running")

    // 显式停止才取消
    const stopped = await fetch(
      `${baseUrl}/api/ai-assistant/executions/${executionId}/stop`,
      { method: "POST" }
    )
    expect(stopped.status).toBe(200)
    expect(fake.aborted).toBe(true)

    release()
    const after = await waitForStatus(executionId, "unknown")
    expect(after.execution.cancelled).toBe(true)
    expect(store.readSession("stop-1").status).toBe("unknown")
  })

  it("订阅不存在的执行返回 404", async () => {
    const response = await fetch(
      `${baseUrl}/api/ai-assistant/executions/exec-missing/events`
    )
    expect(response.status).toBe(404)
  })
})

describe("清空会话的接线", () => {
  it("执行中的会话返回 409，且不会丢掉内存会话", async () => {
    const store = await import("./store")
    const sessionApi = await import("./session")
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
    const sessionApi = await import("./session")
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
