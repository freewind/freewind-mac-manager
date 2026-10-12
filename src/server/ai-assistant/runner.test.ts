import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { StreamableSession } from "./stream"

/**
 * 用受控替身替代 SDK：建会话不读本机配置、不联网、不起子进程。
 * runner 的行为只依赖 StreamableSession 的四个能力，替身足够驱动。
 */
vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: async () => ({ session: { dispose: () => {} } }),
  DefaultResourceLoader: class {
    async reload(): Promise<void> {}
  },
  SessionManager: { inMemory: () => ({}) },
  ModelRuntime: class {},
  defineTool: (definition: unknown) => definition,
}))

vi.mock("./model-runtime", () => ({
  createAssistantModelRuntime: async () => ({ getModel: () => ({ id: "m" }) }),
}))

let directory = ""
let dbFile = ""

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), "ai-assistant-runner-test-"))
  dbFile = path.join(directory, "test.sqlite3")
  process.env.MAC_MANAGER_DB_FILE = dbFile
  vi.resetModules()
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.MAC_MANAGER_DB_FILE
  rmSync(directory, { recursive: true, force: true })
})

/** 受控会话替身：测试自己决定 prompt 何时结束、发出哪些事件。 */
const makeFake = () => {
  const listeners: Array<(event: AgentSessionEvent) => void> = []
  const state = {
    aborted: false,
    answer: undefined as string | undefined,
    run: async (_text: string): Promise<void> => {},
  }
  const session = {
    subscribe: (listener: (event: AgentSessionEvent) => void) => {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
    prompt: (text: string) => state.run(text),
    abort: () => {
      state.aborted = true
    },
    getLastAssistantText: () => state.answer,
  } as unknown as StreamableSession
  const emit = (event: unknown): void => {
    for (const listener of [...listeners]) listener(event as AgentSessionEvent)
  }
  return { session, state, emit, listenerCount: () => listeners.length }
}

const delta = (value: string) => ({
  type: "message_update",
  assistantMessageEvent: { type: "text_delta", delta: value },
})

const collector = () => {
  const events: string[] = []
  let ended = false
  return {
    events,
    isEnded: () => ended,
    observer: {
      onEvent: (event: { type: string }) => {
        events.push(event.type)
      },
      onEnd: () => {
        ended = true
      },
    },
  }
}

const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let index = 0; index < 200; index += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error("等待执行进入终态超时")
}

describe("执行归服务端", () => {
  it("订阅者断开后执行继续跑到终态，不中止 Agent", async () => {
    const store = await import("./store")
    const runner = await import("./runner")
    store.saveSession({ id: "s1", settingsSnapshot: {} })
    const fake = makeFake()
    let release: () => void = () => {}
    fake.state.run = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })

    const started = runner.startExecution({
      session: fake.session,
      sessionId: "s1",
      prompt: "你好",
    })
    // 订阅后立刻断开：只退订，不触碰执行
    const unsubscribe = runner.subscribeExecution(
      started.execution.id,
      collector().observer
    )
    unsubscribe()
    expect(fake.listenerCount()).toBe(1)

    expect(runner.getExecution(started.execution.id).status).toBe("running")

    fake.emit(delta("半"))
    fake.state.answer = "答案"
    release()
    await waitFor(
      () => runner.getExecution(started.execution.id).status !== "running"
    )

    const snapshot = runner.getExecution(started.execution.id)
    expect(snapshot.status).toBe("done")
    expect(snapshot.answer).toBe("答案")
    expect(snapshot.cancelled).toBe(false)
    // 断线没有触发 abort
    expect(fake.state.aborted).toBe(false)
    expect(store.readSession("s1").status).toBe("done")
    expect(store.readSession("s1").messages).toEqual([
      { role: "user", text: "你好" },
      { role: "assistant", text: "答案" },
    ])
  })

  it("断开后重新订阅，能补齐同一执行的事件与最终结果", async () => {
    const store = await import("./store")
    const runner = await import("./runner")
    store.saveSession({ id: "s2", settingsSnapshot: {} })
    const fake = makeFake()
    fake.state.run = async () => {
      fake.emit(delta("答"))
      fake.state.answer = "答案"
    }

    const started = runner.startExecution({
      session: fake.session,
      sessionId: "s2",
      prompt: "你好",
    })
    await waitFor(
      () => runner.getExecution(started.execution.id).status === "done"
    )

    // 执行已经结束才订阅：重放缓冲事件，并立刻收到结束通知
    const seen = collector()
    runner.subscribeExecution(started.execution.id, seen.observer)
    expect(seen.isEnded()).toBe(true)
    expect(seen.events).toEqual(["delta", "done"])

    // 重新订阅不带指令：库里仍只有最初那一条用户消息
    expect(store.readSession("s2").messages).toEqual([
      { role: "user", text: "你好" },
      { role: "assistant", text: "答案" },
    ])
  })

  it("同一请求标识只执行一次，不产生第二次副作用", async () => {
    const store = await import("./store")
    const runner = await import("./runner")
    store.saveSession({ id: "s3", settingsSnapshot: {} })
    const fake = makeFake()
    let promptCalls = 0
    fake.state.run = async () => {
      promptCalls += 1
      fake.state.answer = "答案"
    }
    const requestId = "req-0000000000000001"

    const first = runner.startExecution({
      session: fake.session,
      sessionId: "s3",
      prompt: "你好",
      requestId,
    })
    const second = runner.startExecution({
      session: fake.session,
      sessionId: "s3",
      prompt: "你好",
      requestId,
    })

    expect(second.reused).toBe(true)
    expect(second.execution.id).toBe(first.execution.id)
    await waitFor(
      () => runner.getExecution(first.execution.id).status === "done"
    )
    expect(promptCalls).toBe(1)
    expect(store.readSession("s3").messages).toHaveLength(2)
  })

  it("同一会话重复提交（不同请求标识）被拒，且明确没有开始执行", async () => {
    const store = await import("./store")
    const runner = await import("./runner")
    store.saveSession({ id: "s4", settingsSnapshot: {} })
    const fake = makeFake()
    fake.state.run = () => new Promise<void>(() => {})

    runner.startExecution({
      session: fake.session,
      sessionId: "s4",
      prompt: "第一次",
    })

    expect(() =>
      runner.startExecution({
        session: fake.session,
        sessionId: "s4",
        prompt: "第二次",
      })
    ).toThrow("正在执行")
    // 第一个 run 的状态没有被第二个请求改写
    expect(store.readSession("s4").messages).toEqual([
      { role: "user", text: "第一次" },
    ])
  })

  it("只有显式停止才取消执行", async () => {
    const store = await import("./store")
    const runner = await import("./runner")
    store.saveSession({ id: "s5", settingsSnapshot: {} })
    const fake = makeFake()
    let release: () => void = () => {}
    fake.state.run = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })

    const started = runner.startExecution({
      session: fake.session,
      sessionId: "s5",
      prompt: "你好",
    })
    const unsubscribe = runner.subscribeExecution(
      started.execution.id,
      collector().observer
    )
    unsubscribe()
    // 退订不等于取消
    expect(fake.state.aborted).toBe(false)

    const stopped = runner.stopExecution(started.execution.id)
    expect(stopped.cancelled).toBe(true)
    expect(fake.state.aborted).toBe(true)

    release()
    await waitFor(
      () => runner.getExecution(started.execution.id).status !== "running"
    )
    const snapshot = runner.getExecution(started.execution.id)
    expect(snapshot.status).toBe("unknown")
    expect(snapshot.cancelled).toBe(true)
    expect(snapshot.message).toBe("已停止，结果未知")
    // 取消也绝不写成成功
    expect(store.readSession("s5").status).toBe("unknown")

    // 已经结束的执行不能再停
    expect(() => runner.stopExecution(started.execution.id)).toThrow("无法停止")
  })

  it("丢弃会话时执行按结果未知收尾，不会被说成成功", async () => {
    const store = await import("./store")
    const runner = await import("./runner")
    const sessionApi = await import("./session")
    store.saveSession({ id: "s6", settingsSnapshot: {} })
    const fake = makeFake()
    let release: () => void = () => {}
    fake.state.run = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })

    const started = runner.startExecution({
      session: fake.session,
      sessionId: "s6",
      prompt: "你好",
    })
    sessionApi.disposeSession("s6")
    release()
    await waitFor(
      () => runner.getExecution(started.execution.id).status !== "running"
    )

    const snapshot = runner.getExecution(started.execution.id)
    expect(snapshot.status).toBe("unknown")
    expect(snapshot.cancelled).toBe(true)
    expect(snapshot.message).toBe("会话已丢弃，结果未知")
    expect(store.readSession("s6").status).toBe("unknown")
  })
})

describe("空闲回收与重启恢复", () => {
  it("执行中的会话不被空闲回收，空闲的会被回收", async () => {
    const sessionApi = await import("./session")
    const settings = {
      settings: { providerId: "p", modelId: "m" },
      signature: "s",
      updatedAt: 1,
      defaults: { systemPrompt: "x", enabledTools: [] },
    }
    const running = await sessionApi.createSession(settings)
    const idle = await sessionApi.createSession(settings)

    // runner 用同一把在途锁标记「执行中」，这里直接复现该状态。
    sessionApi.beginSessionRun(running.sessionId)

    let now = Date.now()
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now)
    now += sessionApi.AI_ASSISTANT_SESSION_IDLE_MS + 1

    // 任意一次会话访问都会顺带做一次空闲回收
    expect(() => sessionApi.getSession(idle.sessionId)).toThrow("会话不存在")
    expect(() => sessionApi.getSession(running.sessionId)).not.toThrow()
    clock.mockRestore()
  })

  it("重启把未决 running 标为 unknown，且不自动重放", async () => {
    const requestId = "req-0000000000000002"
    // 模拟上次进程被杀留下的 running 记录（含请求标识）。
    const raw = new DatabaseSync(dbFile)
    raw.exec(`CREATE TABLE ai_assistant_session (
      id TEXT PRIMARY KEY,
      settings_snapshot TEXT NOT NULL,
      messages TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'idle',
      request_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );`)
    raw
      .prepare(
        `INSERT INTO ai_assistant_session(
           id, settings_snapshot, messages, status, request_id, created_at, updated_at
         ) VALUES(?,?,?,?,?,?,?)`
      )
      .run(
        "orphan",
        "{}",
        JSON.stringify([{ role: "user", text: "上次没跑完" }]),
        "running",
        requestId,
        1,
        1
      )
    raw.close()

    const store = await import("./store")
    const runner = await import("./runner")
    const row = store.readSession("orphan")
    expect(row.status).toBe("unknown")
    expect(row.requestId).toBe(requestId)
    expect(row.messages).toEqual([{ role: "user", text: "上次没跑完" }])

    // 不自动重放：同一请求标识再提交必须被拒，不能再产生一次副作用
    const fake = makeFake()
    expect(() =>
      runner.startExecution({
        session: fake.session,
        sessionId: "orphan",
        prompt: "再来一次",
        requestId,
      })
    ).toThrow("已经提交过")
  })
})
