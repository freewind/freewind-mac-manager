import { ApiPath } from "@shared/api-path"
import { buildAuthorizationHeader } from "./access-password"
import {
  ApiRequestError,
  assertWriteOnline,
  dispatchUnauthorized,
  unwrap,
} from "./client"

/**
 * SSE 流式端点不在 ts-rest 契约里（ts-rest 不支持 text/event-stream），
 * 但传输逻辑仍归 client-api：前端只调用这里的具名函数，不自己拼地址与请求。
 */

export type SseEvent = { event: string; data: string }

/** 助手流的事件：把线上格式收敛成前端可直接消费的形状。 */
export type AiAssistantStreamEvent =
  | { type: "delta"; kind: "text" | "thinking"; delta: string }
  | {
      type: "tool"
      toolCallId: string
      name: string
      status: "running" | "done" | "error"
      input: unknown
      output: unknown
    }
  | { type: "error"; message: string }
  | {
      type: "done"
      status: "done" | "unknown"
      sessionId: string | null
      message: string | null
    }

export type StreamAiAssistantMessageOptions = {
  /** 已有会话传真实 id；新建会话传 null，标识由服务端响应头回传。 */
  sessionId: string | null
  prompt: string
  signal: AbortSignal
  onSessionId?: (sessionId: string) => void
  /** 执行标识由服务端响应头回传，客户端据此在断线后重新订阅同一执行。 */
  onExecutionId?: (executionId: string) => void
  onEvent: (event: AiAssistantStreamEvent) => void
}

/** 会话 id 在请求体里，路径段只是站位：新建时用 new，续接时用真实 id。 */
export const aiAssistantMessagePath = (sessionId: string | null): string =>
  ApiPath.aiAssistantMessage.replace(
    ":sessionId",
    encodeURIComponent(sessionId && sessionId.length > 0 ? sessionId : "new")
  )

/** 执行事件订阅路径：只带执行标识，不带指令。 */
export const aiAssistantExecutionEventsPath = (executionId: string): string =>
  ApiPath.aiAssistantExecutionEvents.replace(
    ":executionId",
    encodeURIComponent(executionId)
  )

/**
 * 按 SSE 的空行分帧。返回已完整的帧与尚未结束的尾巴，
 * 尾巴要留在缓冲区，等下一个 chunk 到齐再解析。
 */
export const parseSseFrames = (
  buffer: string
): { events: SseEvent[]; rest: string } => {
  const chunks = buffer.replace(/\r\n/g, "\n").split("\n\n")
  const rest = chunks.pop() ?? ""
  const events: SseEvent[] = []
  for (const chunk of chunks) {
    if (!chunk.trim()) continue
    let event = "message"
    const dataLines: string[] = []
    for (const line of chunk.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim()
      else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""))
      }
    }
    events.push({ event, data: dataLines.join("\n") })
  }
  return { events, rest }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {}

const parseJson = (text: string): Record<string, unknown> => {
  try {
    return asRecord(JSON.parse(text))
  } catch {
    return {}
  }
}

const toStreamEvent = (event: SseEvent): AiAssistantStreamEvent | null => {
  const data = parseJson(event.data)
  if (event.event === "delta") {
    const delta = data.delta
    if (typeof delta !== "string" || !delta) return null
    return {
      type: "delta",
      kind: data.type === "thinking" ? "thinking" : "text",
      delta,
    }
  }
  if (event.event === "tool") {
    const toolCallId = data.id
    const name = data.name
    if (typeof toolCallId !== "string" || typeof name !== "string") return null
    return {
      type: "tool",
      toolCallId,
      name,
      status:
        data.status === "done"
          ? "done"
          : data.status === "error"
            ? "error"
            : "running",
      input: data.input,
      output: data.output,
    }
  }
  if (event.event === "error") {
    const message = data.message
    return {
      type: "error",
      message: typeof message === "string" ? message : "助手执行失败",
    }
  }
  if (event.event === "done") {
    return {
      type: "done",
      status: data.status === "unknown" ? "unknown" : "done",
      sessionId: typeof data.sessionId === "string" ? data.sessionId : null,
      message: typeof data.message === "string" ? data.message : null,
    }
  }
  return null
}

const readJsonBody = async (response: Response): Promise<unknown> => {
  try {
    const text = await response.text()
    return text ? JSON.parse(text) : undefined
  } catch {
    return undefined
  }
}

/**
 * 读取 SSE 流。reader 在 finally 里释放锁，结束时 flush decoder，
 * 保证最后一个多字节字符与未闭合的帧都不会丢。
 */
const readSseStream = async (
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: SseEvent) => void
): Promise<void> => {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parsed = parseSseFrames(buffer)
      buffer = parsed.rest
      for (const event of parsed.events) onEvent(event)
    }
    buffer += decoder.decode()
    if (buffer.trim()) {
      for (const event of parseSseFrames(`${buffer}\n\n`).events) onEvent(event)
    }
  } catch (error) {
    if (signal.aborted) throw error
    throw new ApiRequestError(
      "响应中断，结果未知，请重新读取确认",
      null,
      undefined,
      error,
      true
    )
  } finally {
    reader.releaseLock()
  }
}

/**
 * 发起一次助手对话并读取流式响应。
 *
 * 写操作方法先做离线拦截；401 派发全局未授权事件；HTTP 失败复用 unwrap 的
 * 解包与错误语义；网络中断按「结果未知」上报。不自动重试。
 */
export const streamAiAssistantMessage = async (
  options: StreamAiAssistantMessageOptions
): Promise<void> => {
  assertWriteOnline()
  let response: Response
  try {
    response = await fetch(aiAssistantMessagePath(options.sessionId), {
      method: "POST",
      headers: {
        ...buildAuthorizationHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        prompt: options.prompt,
      }),
      signal: options.signal,
    })
  } catch (error) {
    if (options.signal.aborted) throw error
    throw new ApiRequestError(
      "网络请求失败，结果未知，请重新读取确认",
      null,
      undefined,
      error,
      true
    )
  }
  if (response.status === 401) dispatchUnauthorized()
  if (!response.ok) {
    // 复用统一解包：消息、状态码与 executionStatus 的语义与其它请求一致。
    unwrap({ status: response.status, body: await readJsonBody(response) })
    throw new ApiRequestError(
      `请求失败（HTTP ${response.status}）`,
      response.status
    )
  }
  if (!response.body) {
    throw new ApiRequestError(
      "响应没有可读内容，结果未知，请重新读取确认",
      response.status,
      undefined,
      undefined,
      true
    )
  }
  const sessionId = response.headers.get("x-ai-assistant-session-id")
  if (sessionId) options.onSessionId?.(sessionId)
  const executionId = response.headers.get("x-ai-assistant-execution-id")
  if (executionId) options.onExecutionId?.(executionId)
  await readSseStream(response.body, options.signal, (event) => {
    const parsed = toStreamEvent(event)
    if (parsed) options.onEvent(parsed)
  })
}

export type SubscribeAiAssistantExecutionOptions = {
  executionId: string
  signal: AbortSignal
  onEvent: (event: AiAssistantStreamEvent) => void
}

/**
 * 按执行标识重新订阅一个已经提交的执行。
 *
 * 只订阅、不重发原指令：执行归服务端，断线后重新连上看到的是同一执行的
 * 进度与结果。不自动重试，也不因为读不到流就宣告成功；执行是否完成
 * 只能由服务端的 done 帧或状态查询确认。
 */
export const subscribeAiAssistantExecution = async (
  options: SubscribeAiAssistantExecutionOptions
): Promise<void> => {
  let response: Response
  try {
    response = await fetch(
      aiAssistantExecutionEventsPath(options.executionId),
      {
        method: "GET",
        headers: {
          ...buildAuthorizationHeader(),
          Accept: "text/event-stream",
        },
        signal: options.signal,
      }
    )
  } catch (error) {
    if (options.signal.aborted) throw error
    throw new ApiRequestError(
      "网络请求失败，结果未知，请重新读取确认",
      null,
      undefined,
      error,
      true
    )
  }
  if (response.status === 401) dispatchUnauthorized()
  if (!response.ok) {
    unwrap({ status: response.status, body: await readJsonBody(response) })
    throw new ApiRequestError(
      `请求失败（HTTP ${response.status}）`,
      response.status
    )
  }
  if (!response.body) {
    throw new ApiRequestError(
      "响应没有可读内容，结果未知，请重新读取确认",
      response.status,
      undefined,
      undefined,
      true
    )
  }
  await readSseStream(response.body, options.signal, (event) => {
    const parsed = toStreamEvent(event)
    if (parsed) options.onEvent(parsed)
  })
}
