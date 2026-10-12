// @vitest-environment jsdom
import type { AiAssistantStreamEvent } from "@shared/client-api"
import { renderHook, waitFor } from "@testing-library/react"
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  AI_ASSISTANT_TOOL_NAME,
  type ChatMessage,
  toUiMessages,
  useStreamChat,
} from "./use-stream-chat"

const { api } = vi.hoisted(() => ({
  api: { streamAiAssistantMessage: vi.fn() },
}))

// 只替身流式传输：hook 自身不碰网络，行为由这里驱动。
vi.mock(import("@shared/client-api"), async (importOriginal) => ({
  ...(await importOriginal()),
  streamAiAssistantMessage: api.streamAiAssistantMessage,
}))

type StreamOptions = {
  sessionId: string | null
  prompt: string
  signal: AbortSignal
  onSessionId?: (sessionId: string) => void
  onEvent: (event: AiAssistantStreamEvent) => void
}

/** 记录一次 send 期间的调用参数，便于断言传入的会话与提示词。 */
const captureOptions = (): StreamOptions[] => {
  const calls: StreamOptions[] = []
  for (const call of api.streamAiAssistantMessage.mock.calls) {
    calls.push(call[0] as StreamOptions)
  }
  return calls
}

const partsOf = (messages: ReturnType<typeof toUiMessages>[number]) =>
  messages.parts as Array<Record<string, unknown>>

const setup = () => {
  const onSessionId = vi.fn()
  const view = renderHook(
    (props: { sessionId: string | null }) =>
      useStreamChat({ sessionId: props.sessionId, onSessionId }),
    { initialProps: { sessionId: null as string | null } }
  )
  return { ...view, onSessionId }
}

afterEach(() => {
  api.streamAiAssistantMessage.mockReset()
})

describe("toUiMessages", () => {
  it("文本与思考转成 Agent Elements 认识的 part 形状", () => {
    const messages: ChatMessage[] = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          { type: "thinking", text: "想一想", done: true },
          { type: "text", text: "答案" },
        ],
      },
    ]
    expect(toUiMessages(messages)[0].parts).toEqual([
      {
        type: "tool-Thinking",
        toolCallId: "m1-thinking",
        state: "output-available",
        input: { thought: "想一想" },
      },
      { type: "text", text: "答案" },
    ])
  })

  it("自定义工具走用户工具通道，内置工具映射到官方卡片", () => {
    const messages: ChatMessage[] = [
      {
        id: "m2",
        role: "assistant",
        parts: [
          {
            type: "tool",
            toolCallId: "t1",
            name: AI_ASSISTANT_TOOL_NAME,
            status: "done",
            input: { method: "GET", path: "/api/health" },
            output: { status: 200 },
          },
          {
            type: "tool",
            toolCallId: "t2",
            name: "bash",
            status: "running",
            input: { command: "ls" },
            output: undefined,
          },
        ],
      },
    ]
    expect(toUiMessages(messages)[0].parts).toEqual([
      {
        type: "tool-mcp__user-tools__call_mac_manager_api",
        toolCallId: "t1",
        state: "output-available",
        input: { method: "GET", path: "/api/health" },
        output: { status: 200 },
      },
      {
        type: "tool-Bash",
        toolCallId: "t2",
        state: "input-available",
        input: { command: "ls" },
        output: undefined,
      },
    ])
  })
})

describe("useStreamChat", () => {
  it("正常完成：累加文本、记录会话标识、终态 ready", async () => {
    api.streamAiAssistantMessage.mockImplementation(
      async (options: StreamOptions) => {
        options.onSessionId?.("s-1")
        options.onEvent({ type: "delta", kind: "text", delta: "你" })
        options.onEvent({ type: "delta", kind: "text", delta: "好" })
        options.onEvent({
          type: "done",
          status: "done",
          sessionId: "s-1",
          message: null,
        })
      }
    )
    const { result, onSessionId } = setup()

    await act(async () => {
      await result.current.send({ role: "user", content: " 你好 " })
    })

    expect(api.streamAiAssistantMessage).toHaveBeenCalledTimes(1)
    expect(captureOptions()[0].prompt).toBe("你好")
    expect(captureOptions()[0].sessionId).toBeNull()
    expect(onSessionId).toHaveBeenCalledWith("s-1")
    expect(result.current.status).toBe("ready")
    expect(result.current.error).toBeUndefined()
    expect(result.current.sessionId).toBe("s-1")
    expect(result.current.messages).toHaveLength(2)
    expect(partsOf(result.current.messages[1])).toEqual([
      { type: "text", text: "你好" },
    ])
  })

  it("工具开始带 method/path，结束时只带 output，卡片仍保留 method/path", async () => {
    api.streamAiAssistantMessage.mockImplementation(
      async (options: StreamOptions) => {
        options.onEvent({
          type: "tool",
          toolCallId: "t1",
          name: AI_ASSISTANT_TOOL_NAME,
          status: "running",
          input: { method: "GET", path: "/api/health" },
          output: undefined,
        })
        options.onEvent({
          type: "tool",
          toolCallId: "t1",
          name: AI_ASSISTANT_TOOL_NAME,
          status: "done",
          input: undefined,
          output: { status: 200 },
        })
        options.onEvent({
          type: "done",
          status: "done",
          sessionId: "s-1",
          message: null,
        })
      }
    )
    const { result } = setup()

    await act(async () => {
      await result.current.send({ role: "user", content: "查健康" })
    })

    expect(partsOf(result.current.messages[1])).toEqual([
      {
        type: "tool-mcp__user-tools__call_mac_manager_api",
        toolCallId: "t1",
        state: "output-available",
        input: { method: "GET", path: "/api/health" },
        output: { status: 200 },
      },
    ])
  })

  it("流没有 done 事件时按连接中断标为结果未知", async () => {
    api.streamAiAssistantMessage.mockImplementation(
      async (options: StreamOptions) => {
        options.onEvent({ type: "delta", kind: "text", delta: "半句" })
      }
    )
    const { result } = setup()

    await act(async () => {
      await result.current.send({ role: "user", content: "你好" })
    })

    expect(result.current.status).toBe("error")
    expect(result.current.error?.message).toContain("连接中断，结果未知")
    // 已经收到的半句保留，不伪装成完整回答。
    expect(partsOf(result.current.messages[1])).toEqual([
      { type: "text", text: "半句" },
    ])
  })

  it("服务端 done 的 status=unknown 时标为结果未知并带上服务端说明", async () => {
    api.streamAiAssistantMessage.mockImplementation(
      async (options: StreamOptions) => {
        options.onEvent({
          type: "done",
          status: "unknown",
          sessionId: "s-1",
          message: "执行未完成，结果未知",
        })
      }
    )
    const { result } = setup()

    await act(async () => {
      await result.current.send({ role: "user", content: "危险操作" })
    })

    expect(result.current.status).toBe("error")
    expect(result.current.error?.message).toBe("执行未完成，结果未知")
  })

  it("stop 中止传输并按结果未知收尾", async () => {
    api.streamAiAssistantMessage.mockImplementation(
      (options: StreamOptions) =>
        new Promise<void>((_resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () =>
              reject(
                Object.assign(new Error("aborted"), { name: "AbortError" })
              ),
            { once: true }
          )
        })
    )
    const { result } = setup()

    await act(async () => {
      void result.current.send({ role: "user", content: "长回答" })
    })
    expect(result.current.status).toBe("submitted")

    act(() => result.current.stop())
    await waitFor(() => expect(result.current.status).toBe("error"))
    expect(result.current.error?.message).toContain("已中止，结果未知")
  })

  it("上一条还在流里时忽略新指令，不重复发送", async () => {
    let release: () => void = () => {}
    api.streamAiAssistantMessage.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const { result } = setup()

    await act(async () => {
      void result.current.send({ role: "user", content: "第一条" })
    })
    await act(async () => {
      await result.current.send({ role: "user", content: "第二条" })
    })

    expect(api.streamAiAssistantMessage).toHaveBeenCalledTimes(1)
    expect(result.current.messages).toHaveLength(2)

    await act(async () => {
      release()
    })
    // 释放后没有 done：按连接中断收尾，但仍只有一次请求。
    expect(api.streamAiAssistantMessage).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe("error")
  })

  it("续接会话时把已有 id 传给传输层", async () => {
    api.streamAiAssistantMessage.mockImplementation(
      async (options: StreamOptions) => {
        options.onEvent({
          type: "done",
          status: "done",
          sessionId: "s-1",
          message: null,
        })
      }
    )
    const { result } = setup()
    // 第一次发送拿到会话 id，模拟浮层重新打开后带着 id 续接。
    await act(async () => {
      await result.current.send({ role: "user", content: "第一次" })
    })
    await act(async () => {
      await result.current.send({ role: "user", content: "第二次" })
    })

    expect(captureOptions()[1].sessionId).toBe("s-1")
  })
})
