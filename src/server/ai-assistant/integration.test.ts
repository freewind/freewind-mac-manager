import { mkdtempSync, rmSync } from "node:fs"
import type { Server } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { TaskStore } from "@server/common/tasks/store"
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

/** 受控会话替身：不碰真实 SDK，也不读本机配置。 */
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
const emit = (event: unknown): void => {
  for (const listener of [...listeners]) listener(event)
}

// 只替身会话的创建/查找/丢弃；在途锁与 dispose 通知保持真实。
vi.mock("./session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session")>()),
  createSession: vi.fn(),
  getSession: vi.fn(() => fakeSession),
  disposeSession: vi.fn(),
}))

import { createTaskRuntime, type TaskRuntime } from "../tasks/runtime"

/**
 * 用真实 createApp 走一遍 HTTP：提交执行 → 主动断开连接 → 再查状态能看到
 * 执行完成。临时数据库、禁用业务初始化、不调用真实系统命令。
 */
const TEST_PASSWORD = "test-password"
let dir: string
let runtime: TaskRuntime
let server: Server
let baseUrl: string
let savedPassword: string | undefined
let savedDbFile: string | undefined

const authHeaders = (
  extra: Record<string, string> = {}
): Record<string, string> => ({
  authorization: `Bearer ${TEST_PASSWORD}`,
  ...extra,
})

const submit = (sessionId: string, prompt: string, signal: AbortSignal) =>
  fetch(`${baseUrl}/api/ai-assistant/sessions/${sessionId}/message`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ sessionId, prompt }),
    signal,
  })

/** 执行标识从响应头取；缺了就是接线坏了，直接失败。 */
const executionIdOf = (response: Response): string => {
  const executionId = response.headers.get("x-ai-assistant-execution-id")
  if (!executionId) throw new Error("响应缺少执行标识头")
  return executionId
}

const fetchExecution = async (executionId: string) => {
  const response = await fetch(
    `${baseUrl}/api/ai-assistant/executions/${executionId}`,
    { headers: authHeaders() }
  )
  expect(response.status).toBe(200)
  return (await response.json()) as {
    execution: { status: string; answer: string | null; cancelled: boolean }
    messages: unknown[]
  }
}

const waitForStatus = async (executionId: string, status: string) => {
  for (let index = 0; index < 200; index += 1) {
    const body = await fetchExecution(executionId)
    if (body.execution.status === status) return body
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`等待执行进入 ${status} 超时`)
}

beforeEach(async () => {
  savedPassword = process.env.MAC_MANAGER_PASSWORD
  savedDbFile = process.env.MAC_MANAGER_DB_FILE
  process.env.MAC_MANAGER_PASSWORD = TEST_PASSWORD
  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-ai-assistant-"))
  process.env.MAC_MANAGER_DB_FILE = path.join(dir, "ai.sqlite3")
  fake.aborted = false
  fake.answer = undefined
  fake.run = async () => {}
  listeners.length = 0
  runtime = createTaskRuntime({
    store: new TaskStore(path.join(dir, "tasks.sqlite3")),
    recoverInterrupted: false,
    host: {
      execute: () => {
        throw new Error("测试禁止执行真实命令")
      },
    },
  })
  // env 在模块加载时读 MAC_MANAGER_DB_FILE，所以先设好再重新载入应用。
  vi.resetModules()
  const { createApp } = await import("@server/app")
  const app = createApp({ tasks: runtime, initializeBusiness: false })
  server = app.listen(0)
  await new Promise((resolve) => server.once("listening", resolve))
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve))
  runtime.runner.shutdown()
  rmSync(dir, { recursive: true, force: true })
  if (savedPassword === undefined) delete process.env.MAC_MANAGER_PASSWORD
  else process.env.MAC_MANAGER_PASSWORD = savedPassword
  if (savedDbFile === undefined) delete process.env.MAC_MANAGER_DB_FILE
  else process.env.MAC_MANAGER_DB_FILE = savedDbFile
  expect(businessStore).not.toHaveBeenCalled()
  expect(command).not.toHaveBeenCalled()
  expect(migrate).not.toHaveBeenCalled()
})

describe("执行所有权归服务端（真实 createApp）", () => {
  it("未认证被拒", async () => {
    const response = await fetch(
      `${baseUrl}/api/ai-assistant/sessions/any/message`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "你好" }),
      }
    )
    expect(response.status).toBe(401)
  })

  it("提交后主动断开连接，执行继续并能在状态查询里看到完成", async () => {
    const store = await import("./store")
    store.saveSession({ id: "sess-1", settingsSnapshot: {} })
    let release: () => void = () => {}
    fake.run = async () => {
      emit({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "半" },
      })
      await new Promise<void>((resolve) => {
        release = resolve
      })
      fake.answer = "答案"
    }

    const controller = new AbortController()
    const response = await submit("sess-1", "你好", controller.signal)
    expect(response.status).toBe(200)
    const executionId = executionIdOf(response)
    expect(executionId).toMatch(/^exec-/)
    expect(response.headers.get("x-ai-assistant-session-id")).toBe("sess-1")

    // 确认流真的在推事件，然后主动断开（等价于切后台/锁屏/关标签页）
    const reader = response.body?.getReader()
    const first = await reader?.read()
    expect(new TextDecoder().decode(first?.value)).toContain("event: delta")

    controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 100))
    // 断开没有中止 Agent
    expect(fake.aborted).toBe(false)
    expect((await fetchExecution(executionId)).execution.status).toBe("running")

    release()
    const done = await waitForStatus(executionId, "done")
    expect(done.execution.answer).toBe("答案")
    expect(done.execution.cancelled).toBe(false)
    expect(done.messages).toEqual([
      { role: "user", text: "你好" },
      { role: "assistant", text: "答案" },
    ])
    expect(store.readSession("sess-1").status).toBe("done")
  })

  it("断开后按执行标识重新订阅，拿到同一执行的事件与最终结果", async () => {
    const store = await import("./store")
    store.saveSession({ id: "sess-2", settingsSnapshot: {} })
    let release: () => void = () => {}
    fake.run = async () => {
      emit({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "半" },
      })
      await new Promise<void>((resolve) => {
        release = resolve
      })
      fake.answer = "答案"
    }

    const controller = new AbortController()
    const response = await submit("sess-2", "你好", controller.signal)
    const executionId = executionIdOf(response)
    const reader = response.body?.getReader()
    await reader?.read()
    controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 100))

    // 重新订阅只带执行标识，不重发原指令
    const live = await fetch(
      `${baseUrl}/api/ai-assistant/executions/${executionId}/events`,
      { headers: authHeaders({ accept: "text/event-stream" }) }
    )
    expect(live.status).toBe(200)
    const liveReader = live.body?.getReader()
    const replayed = new TextDecoder().decode((await liveReader?.read())?.value)
    expect(replayed).toContain('"delta":"半"')

    release()
    await waitForStatus(executionId, "done")

    // 已经结束的执行再订阅：重放全部事件后立刻收尾
    const replay = await fetch(
      `${baseUrl}/api/ai-assistant/executions/${executionId}/events`,
      { headers: authHeaders({ accept: "text/event-stream" }) }
    )
    expect(replay.status).toBe(200)
    const text = await replay.text()
    expect(text).toContain('"delta":"半"')
    expect(text).toContain('"status":"done"')
    // 重新订阅没有产生第二条用户消息
    expect((await fetchExecution(executionId)).messages).toEqual([
      { role: "user", text: "你好" },
      { role: "assistant", text: "答案" },
    ])
  })

  it("只有显式停止才取消，停止后状态是未知而不是成功", async () => {
    const store = await import("./store")
    store.saveSession({ id: "sess-3", settingsSnapshot: {} })
    let release: () => void = () => {}
    fake.run = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })

    const controller = new AbortController()
    const response = await submit("sess-3", "你好", controller.signal)
    const executionId = executionIdOf(response)
    controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(fake.aborted).toBe(false)

    const stopped = await fetch(
      `${baseUrl}/api/ai-assistant/executions/${executionId}/stop`,
      { method: "POST", headers: authHeaders() }
    )
    expect(stopped.status).toBe(200)
    expect(fake.aborted).toBe(true)

    release()
    const done = await waitForStatus(executionId, "unknown")
    expect(done.execution.cancelled).toBe(true)
    expect(store.readSession("sess-3").status).toBe("unknown")
  })
})
