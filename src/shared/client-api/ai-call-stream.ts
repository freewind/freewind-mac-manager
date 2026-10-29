import { ApiPath } from "@shared/api-path"
import { buildAuthorizationHeader } from "./access-password"
import {
  type AiAssistantStreamEvent,
  readJsonBody,
  readSseStream,
  toStreamEvent,
} from "./ai-assistant-stream"
import {
  ApiRequestError,
  assertWriteOnline,
  dispatchUnauthorized,
  unwrap,
} from "./client"

/**
 * AI 通话的对话流。
 *
 * 通话只有一条线：一次发言属于一个会话，回答直接来自 Agent 正文，
 * 客户端拿到 delta 就按句念出来。传输层与助手流完全一致，分帧与事件
 * 解析直接复用，不再复制一份。
 */

export type StreamAiCallMessageOptions = {
  sessionId: string
  prompt: string
  signal: AbortSignal
  /** 执行标识由服务端响应头回传，客户端据此在断线后核实同一执行。 */
  onExecutionId?: (executionId: string) => void
  onEvent: (event: AiAssistantStreamEvent) => void
}

export const aiCallMessagePath = (sessionId: string): string =>
  ApiPath.aiCallMessage.replace(":sessionId", encodeURIComponent(sessionId))

export const streamAiCallMessage = async (
  options: StreamAiCallMessageOptions
): Promise<void> => {
  assertWriteOnline()
  let response: Response
  try {
    response = await fetch(aiCallMessagePath(options.sessionId), {
      method: "POST",
      headers: {
        ...buildAuthorizationHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: options.prompt }),
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
  const executionId = response.headers.get("x-ai-assistant-execution-id")
  if (executionId) options.onExecutionId?.(executionId)
  await readSseStream(response.body, options.signal, (event) => {
    const parsed = toStreamEvent(event)
    if (parsed) options.onEvent(parsed)
  })
}
