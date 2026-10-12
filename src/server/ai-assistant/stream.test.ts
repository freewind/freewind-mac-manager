import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SseResponse, StreamableSession } from "./stream"

let directory = ""

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), "ai-assistant-stream-test-"))
  process.env.MAC_MANAGER_DB_FILE = path.join(directory, "test.sqlite3")
  vi.resetModules()
})

afterEach(() => {
  delete process.env.MAC_MANAGER_DB_FILE
  rmSync(directory, { recursive: true, force: true })
})

/** 测试替身只需要 SSE 用到的这几项能力。 */
type FakeSession = {
  listeners: Array<(event: unknown) => void>
  prompt: (text: string) => Promise<void>
  aborted: boolean
  answer: string | undefined
}

const makeSession = (
  run: (emit: (event: unknown) => void) => Promise<void>
): FakeSession => {
  const fake: FakeSession = {
    listeners: [],
    prompt: async (text: string) => {
      void text
      await run((event) => {
        for (const listener of fake.listeners) listener(event)
      })
    },
    aborted: false,
    answer: undefined,
  }
  return fake
}

const asSession = (fake: FakeSession): StreamableSession =>
  ({
    subscribe: (listener: (event: unknown) => void) => {
      fake.listeners.push(listener)
      return () => {
        fake.listeners = []
      }
    },
    prompt: (text: string) => fake.prompt(text),
    abort: () => {
      fake.aborted = true
    },
    getLastAssistantText: () => fake.answer,
  }) as unknown as StreamableSession

const makeResponse = () => {
  const chunks: string[] = []
  const closeListeners: Array<() => void> = []
  let ended = false
  const response = {
    setHeader: () => undefined,
    flushHeaders: () => undefined,
    write: (chunk: string) => {
      chunks.push(chunk)
      return true
    },
    end: () => {
      ended = true
    },
    on: (_event: "close", listener: () => void) => {
      closeListeners.push(listener)
    },
  }
  return {
    response: response as unknown as SseResponse,
    text: () => chunks.join(""),
    isEnded: () => ended,
    emitClose: () => {
      for (const listener of closeListeners) listener()
    },
  }
}

const delta = (kind: "text" | "thinking", value: string) => ({
  type: "message_update",
  assistantMessageEvent: { type: `${kind}_delta`, delta: value },
})

describe("streamSession SSE 桥接", () => {
  it("转发增量与工具事件，正常收尾为 done", async () => {
    const { streamSession } = await import("./stream")
    const store = await import("./store")
    store.saveSession({ id: "s1", settingsSnapshot: { providerId: "p" } })
    const fake = makeSession(async (emit) => {
      emit(delta("text", "你"))
      emit(delta("thinking", "想"))
      emit({
        type: "tool_execution_start",
        toolCallId: "t1",
        toolName: "read",
        args: { path: "a" },
      })
      emit({
        type: "tool_execution_end",
        toolCallId: "t1",
        toolName: "read",
        result: "ok",
        isError: false,
      })
      emit({ type: "message_end", message: { role: "assistant" } })
    })
    fake.answer = "答案"
    const recorder = makeResponse()

    await streamSession(asSession(fake), "s1", "你好", recorder.response)

    const text = recorder.text()
    expect(text).toContain('event: delta\ndata: {"type":"text","delta":"你"}')
    expect(text).toContain(
      'event: delta\ndata: {"type":"thinking","delta":"想"}'
    )
    expect(text).toContain('"status":"running"')
    expect(text).toContain('"status":"done","output":"ok"')
    expect(text).toContain('event: message_end\ndata: {"role":"assistant"}')
    expect(text).toContain(
      'event: done\ndata: {"status":"done","sessionId":"s1"}'
    )
    expect(recorder.isEnded()).toBe(true)

    const stored = store.readSession("s1")
    expect(stored.status).toBe("done")
    expect(stored.messages).toEqual([
      { role: "user", text: "你好" },
      { role: "assistant", text: "答案" },
    ])
  })

  it("连接中断时中止上游并标为结果未知", async () => {
    const { streamSession } = await import("./stream")
    const store = await import("./store")
    store.saveSession({ id: "s2", settingsSnapshot: {} })
    let resolvePrompt: () => void = () => {}
    const fake = makeSession(
      () =>
        new Promise<void>((resolve) => {
          resolvePrompt = resolve
        })
    )
    const session = asSession(fake)
    const recorder = makeResponse()

    const running = streamSession(session, "s2", "你好", recorder.response)
    recorder.emitClose()
    resolvePrompt()
    await running

    const text = recorder.text()
    expect(fake.aborted).toBe(true)
    expect(text).toContain('"status":"unknown"')
    expect(text).toContain("连接中断，结果未知")
    expect(recorder.isEnded()).toBe(true)
  })

  it("prompt 抛错时回 error 与 unknown 终态", async () => {
    const { streamSession } = await import("./stream")
    const store = await import("./store")
    store.saveSession({ id: "s3", settingsSnapshot: {} })
    const fake = makeSession(async () => {
      throw new Error("上游失败")
    })
    const recorder = makeResponse()

    await streamSession(asSession(fake), "s3", "你好", recorder.response)

    const text = recorder.text()
    expect(text).toContain('event: error\ndata: {"message":"上游失败"}')
    expect(text).toContain('"status":"unknown"')
    expect(store.readSession("s3").status).toBe("unknown")
  })
})
