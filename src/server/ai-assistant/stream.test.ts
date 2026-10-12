import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SseResponse, StreamableSession } from "./stream"

let directory = ""

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), "ai-assistant-stream-test-"))
  process.env.MAC_MANAGER_DB_FILE = path.join(directory, "test.sqlite3")
  vi.resetModules()
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.MAC_MANAGER_DB_FILE
  rmSync(directory, { recursive: true, force: true })
})

/** 测试替身只需要会话里确实要用到的这几项能力。 */
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
  return { session, state, emit }
}

const delta = (kind: "text" | "thinking", value: string) => ({
  type: "message_update",
  assistantMessageEvent: { type: `${kind}_delta`, delta: value },
})

const makeResponse = () => {
  const chunks: string[] = []
  const headers: Record<string, string> = {}
  const closeListeners: Array<() => void> = []
  let ended = false
  const response = {
    setHeader: (name: string, value: string) => {
      headers[name] = value
    },
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
    headers,
    isEnded: () => ended,
    emitClose: () => {
      for (const listener of closeListeners) listener()
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

describe("streamSession SSE 桥接", () => {
  it("转发增量与工具事件，正常收尾为 done", async () => {
    const { streamSession } = await import("./stream")
    const store = await import("./store")
    store.saveSession({ id: "s1", settingsSnapshot: { providerId: "p" } })
    const fake = makeFake()
    fake.state.run = async () => {
      fake.emit(delta("text", "你"))
      fake.emit(delta("thinking", "想"))
      fake.emit({
        type: "tool_execution_start",
        toolCallId: "t1",
        toolName: "read",
        args: { path: "a" },
      })
      fake.emit({
        type: "tool_execution_end",
        toolCallId: "t1",
        toolName: "read",
        result: "ok",
        isError: false,
      })
      fake.state.answer = "答案"
      fake.emit({ type: "message_end", message: { role: "assistant" } })
    }
    const recorder = makeResponse()

    await streamSession(fake.session, "s1", "你好", recorder.response)

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

  it("response 触发 close 时不调用 abort，执行继续跑到终态", async () => {
    const { streamSession } = await import("./stream")
    const runner = await import("./runner")
    const store = await import("./store")
    store.saveSession({ id: "s2", settingsSnapshot: {} })
    const fake = makeFake()
    let release: () => void = () => {}
    fake.state.run = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })

    const recorder = makeResponse()
    const streaming = streamSession(
      fake.session,
      "s2",
      "你好",
      recorder.response
    )
    const executionId = recorder.headers["x-ai-assistant-execution-id"]
    expect(executionId).toBeTruthy()

    // 连接断开：只退订，不中止执行
    recorder.emitClose()
    await streaming
    expect(fake.state.aborted).toBe(false)
    expect(runner.getExecution(executionId).status).toBe("running")

    fake.state.answer = "答案"
    release()
    await waitFor(() => runner.getExecution(executionId).status !== "running")
    expect(runner.getExecution(executionId).status).toBe("done")
    expect(store.readSession("s2").status).toBe("done")
  })

  it("断开后按执行标识重新订阅，拿到事件与最终结果", async () => {
    const { streamExecutionEvents, streamSession } = await import("./stream")
    const runner = await import("./runner")
    const store = await import("./store")
    store.saveSession({ id: "s3", settingsSnapshot: {} })
    const fake = makeFake()
    let release: () => void = () => {}
    fake.state.run = async () => {
      fake.emit(delta("text", "半"))
      await new Promise<void>((resolve) => {
        release = resolve
      })
      fake.state.answer = "答案"
    }

    const first = makeResponse()
    const streaming = streamSession(fake.session, "s3", "你好", first.response)
    const executionId = first.headers["x-ai-assistant-execution-id"]
    first.emitClose()
    await streaming

    // 执行还在跑，此时重新订阅：先补齐已有事件，再跟上增量
    const live = makeResponse()
    const liveStreaming = streamExecutionEvents(executionId, live.response)
    expect(live.text()).toContain('"delta":"半"')

    release()
    await liveStreaming
    expect(live.text()).toContain(
      'event: done\ndata: {"status":"done","sessionId":"s3"}'
    )
    expect(live.isEnded()).toBe(true)

    // 已经结束的执行再订阅：重放全部事件并立刻收尾
    const replay = makeResponse()
    await streamExecutionEvents(executionId, replay.response)
    expect(replay.text()).toContain('"delta":"半"')
    expect(replay.text()).toContain('"status":"done"')
    expect(replay.isEnded()).toBe(true)
    expect(runner.getExecution(executionId).status).toBe("done")
  })

  it("prompt 抛错时回 error 与 unknown 终态", async () => {
    const { streamSession } = await import("./stream")
    const store = await import("./store")
    store.saveSession({ id: "s4", settingsSnapshot: {} })
    const fake = makeFake()
    fake.state.run = async () => {
      throw new Error("上游失败")
    }
    const recorder = makeResponse()

    await streamSession(fake.session, "s4", "你好", recorder.response)

    const text = recorder.text()
    expect(text).toContain('event: error\ndata: {"message":"上游失败"}')
    expect(text).toContain('"status":"unknown"')
    expect(store.readSession("s4").status).toBe("unknown")
  })

  it("prompt 开始前就写了 running 与用户输入，正常结束后转 done", async () => {
    const { streamSession } = await import("./stream")
    const store = await import("./store")
    store.saveSession({ id: "s5", settingsSnapshot: {} })
    let statusDuringPrompt = ""
    let messagesDuringPrompt: unknown[] = []
    const fake = makeFake()
    fake.state.run = async () => {
      const snapshot = store.readSession("s5")
      statusDuringPrompt = snapshot.status
      messagesDuringPrompt = snapshot.messages
    }
    fake.state.answer = "答"
    const recorder = makeResponse()

    await streamSession(fake.session, "s5", "只在中间查一次", recorder.response)

    expect(statusDuringPrompt).toBe("running")
    expect(messagesDuringPrompt).toEqual([
      { role: "user", text: "只在中间查一次" },
    ])
    expect(store.readSession("s5").status).toBe("done")
  })

  it("出错时保留已经拿到的部分回答，终态仍是 unknown", async () => {
    const { streamSession } = await import("./stream")
    const store = await import("./store")
    store.saveSession({ id: "s6", settingsSnapshot: {} })
    const fake = makeFake()
    fake.state.run = async () => {
      throw new Error("上游失败")
    }
    fake.state.answer = "半句"

    await streamSession(fake.session, "s6", "你好", makeResponse().response)

    const stored = store.readSession("s6")
    expect(stored.status).toBe("unknown")
    expect(stored.messages).toEqual([
      { role: "user", text: "你好" },
      { role: "assistant", text: "半句" },
    ])
  })

  it("历史写不进去时不假装完整成功：明确告知并记脱敏日志", async () => {
    const { streamSession } = await import("./stream")
    const store = await import("./store")
    store.saveSession({ id: "s7", settingsSnapshot: {} })
    const fake = makeFake()
    fake.state.run = async () => {
      // 模拟运行期间历史被别的写入方清掉（绕过 clearSession 的执行中保护）。
      const raw = new DatabaseSync(process.env.MAC_MANAGER_DB_FILE ?? "")
      raw.prepare("DELETE FROM ai_assistant_session WHERE id=?").run("s7")
      raw.close()
    }
    fake.state.answer = "答案"
    const recorder = makeResponse()
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await streamSession(fake.session, "s7", "你好", recorder.response)

    expect(recorder.text()).toContain("回答已完成，但会话历史保存失败")
    expect(errorSpy).toHaveBeenCalledTimes(1)
    // 日志只写会话与终态，不带提示词内容。
    expect(String(errorSpy.mock.calls[0][0])).not.toContain("你好")
    errorSpy.mockRestore()
  })

  it("历史不存在时连跑都不跑，错误交给调用方回普通 JSON", async () => {
    const { streamSession } = await import("./stream")
    const recorder = makeResponse()
    const fake = makeFake()
    fake.state.run = async () => {
      throw new Error("不该跑到这里")
    }

    await expect(
      streamSession(fake.session, "missing", "你好", recorder.response)
    ).rejects.toThrow("会话不存在")
    // 还没写过 SSE 头，调用方仍能回 JSON 错误。
    expect(recorder.isEnded()).toBe(false)
    expect(recorder.text()).toBe("")
    expect(recorder.headers["x-ai-assistant-execution-id"]).toBeUndefined()
  })
})
