// @vitest-environment jsdom
import { AUTH_COOKIE_NAME } from "@shared/auth"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  aiAssistantMessagePath,
  parseSseFrames,
  streamAiAssistantMessage,
} from "./ai-assistant-stream"
import { ApiRequestError } from "./client"

/** 把若干 SSE 文本片段装成流式响应体。 */
const sseBody = (chunks: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

const okResponse = (chunks: string[], sessionId = "session-1"): Response =>
  ({
    ok: true,
    status: 200,
    body: sseBody(chunks),
    headers: new Headers({ "x-ai-assistant-session-id": sessionId }),
  }) as unknown as Response

afterEach(() => {
  vi.unstubAllGlobals()
  document.cookie = `${AUTH_COOKIE_NAME}=; path=/; Max-Age=0`
})

const collect = () => {
  const events: unknown[] = []
  return { events, onEvent: (event: unknown) => events.push(event) }
}

describe("aiAssistantMessagePath", () => {
  it("续接用真实会话 id，新建用一个明确占位，不发字面量 :sessionId", () => {
    expect(aiAssistantMessagePath("abc")).toBe(
      "/api/ai-assistant/sessions/abc/message"
    )
    expect(aiAssistantMessagePath(null)).toBe(
      "/api/ai-assistant/sessions/new/message"
    )
    expect(aiAssistantMessagePath("带 空格")).toContain("%20")
  })
})

describe("parseSseFrames", () => {
  it("按空行分帧，未结束的尾巴留在缓冲区", () => {
    const first = parseSseFrames(
      'event: delta\ndata: {"type":"text","delta":"你"}\n\nevent: delta\ndata: {"type'
    )
    expect(first.events).toEqual([
      { event: "delta", data: '{"type":"text","delta":"你"}' },
    ])
    expect(first.rest).toBe('event: delta\ndata: {"type')

    const second = parseSseFrames(`${first.rest}":"text","delta":"好"}\n\n`)
    expect(second.events).toEqual([
      { event: "delta", data: '{"type":"text","delta":"好"}' },
    ])
    expect(second.rest).toBe("")
  })

  it("兼容 CRLF，并支持一段多行 data", () => {
    const { events } = parseSseFrames(
      "event: done\r\ndata: line1\r\ndata: line2\r\n\r\n"
    )
    expect(events).toEqual([{ event: "done", data: "line1\nline2" }])
  })

  it("无 event 字段时按 message 事件处理，空帧被忽略", () => {
    expect(parseSseFrames("data: {}\n\n").events).toEqual([
      { event: "message", data: "{}" },
    ])
    expect(parseSseFrames("\n\n").events).toEqual([])
  })
})

describe("streamAiAssistantMessage", () => {
  it("带鉴权头与真实路径，并把 SSE 转成具名事件", async () => {
    document.cookie = `${AUTH_COOKIE_NAME}=${encodeURIComponent("p@ss word")}`
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        okResponse([
          'event: delta\ndata: {"type":"text","delta":"你"}\n\n',
          'event: tool\ndata: {"id":"t1","name":"call_mac_manager_api","status":"running","input":{"method":"GET","path":"/api/health"}}\n\n',
          'event: tool\ndata: {"id":"t1","name":"call_mac_manager_api","status":"done","output":{"status":200}}\n\nevent: done\ndata: {"status":"done","sessionId":"session-1"}\n\n',
        ])
      )
    vi.stubGlobal("fetch", fetchMock)
    const { events, onEvent } = collect()
    const sessionIds: string[] = []

    await streamAiAssistantMessage({
      sessionId: null,
      prompt: "你好",
      signal: new AbortController().signal,
      onSessionId: (id) => sessionIds.push(id),
      onEvent,
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/ai-assistant/sessions/new/message")
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer p@ss word"
    )
    expect(JSON.parse(String(init.body))).toEqual({ prompt: "你好" })
    expect(sessionIds).toEqual(["session-1"])
    expect(events).toEqual([
      { type: "delta", kind: "text", delta: "你" },
      {
        type: "tool",
        toolCallId: "t1",
        name: "call_mac_manager_api",
        status: "running",
        input: { method: "GET", path: "/api/health" },
        output: undefined,
      },
      {
        type: "tool",
        toolCallId: "t1",
        name: "call_mac_manager_api",
        status: "done",
        input: undefined,
        output: { status: 200 },
      },
      {
        type: "done",
        status: "done",
        sessionId: "session-1",
        message: null,
      },
    ])
  })

  it("续接会话时把真实 id 同时放进路径与请求体", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([]))
    vi.stubGlobal("fetch", fetchMock)

    await streamAiAssistantMessage({
      sessionId: "s-9",
      prompt: "继续",
      signal: new AbortController().signal,
      onEvent: () => undefined,
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/ai-assistant/sessions/s-9/message")
    expect(JSON.parse(String(init.body))).toEqual({
      sessionId: "s-9",
      prompt: "继续",
    })
  })

  it("401 派发全局未授权事件", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        body: null,
        headers: new Headers(),
        text: async () => '{"message":"缺少访问凭据"}',
      } as unknown as Response)
    )
    const onUnauthorized = vi.fn()
    window.addEventListener("mac-manager:unauthorized", onUnauthorized)

    await expect(
      streamAiAssistantMessage({
        sessionId: null,
        prompt: "x",
        signal: new AbortController().signal,
        onEvent: () => undefined,
      })
    ).rejects.toBeInstanceOf(ApiRequestError)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    window.removeEventListener("mac-manager:unauthorized", onUnauthorized)
  })

  it("HTTP 失败复用统一解包，带回业务消息", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        body: null,
        headers: new Headers(),
        text: async () => '{"message":"请先在设置中选择 AI 助手模型"}',
      } as unknown as Response)
    )

    await expect(
      streamAiAssistantMessage({
        sessionId: null,
        prompt: "x",
        signal: new AbortController().signal,
        onEvent: () => undefined,
      })
    ).rejects.toThrow("请先在设置中选择 AI 助手模型")
  })

  it("离线时不发请求", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("navigator", { onLine: false })

    await expect(
      streamAiAssistantMessage({
        sessionId: null,
        prompt: "x",
        signal: new AbortController().signal,
        onEvent: () => undefined,
      })
    ).rejects.toThrow("当前离线")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("网络中断按结果未知上报", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed")))

    await expect(
      streamAiAssistantMessage({
        sessionId: null,
        prompt: "x",
        signal: new AbortController().signal,
        onEvent: () => undefined,
      })
    ).rejects.toMatchObject({ resultUnknown: true })
  })
})
