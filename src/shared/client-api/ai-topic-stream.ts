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
 * AI 话题的对话流。
 *
 * 话题只有一个 Agent，线程只是回答的组织方式：一次请求属于一个话题、
 * 从一个线程发出，回复由服务端决定写回哪个线程。传输层与助手流一致，
 * 分帧与事件解析直接复用，不再复制一份。
 */

export type StreamAiTopicMessageOptions = {
  topicId: string
  /** 本次提问所在的线程。 */
  threadId: string
  prompt: string
  signal: AbortSignal
  /** 执行标识由服务端响应头回传，客户端据此在断线后核实同一执行。 */
  onExecutionId?: (executionId: string) => void
  onEvent: (event: AiAssistantStreamEvent) => void
}

export const aiTopicMessagePath = (topicId: string): string =>
  ApiPath.aiTopicMessage.replace(":topicId", encodeURIComponent(topicId))

export const streamAiTopicMessage = async (
  options: StreamAiTopicMessageOptions
): Promise<void> => {
  assertWriteOnline()
  let response: Response
  try {
    response = await fetch(aiTopicMessagePath(options.topicId), {
      method: "POST",
      headers: {
        ...buildAuthorizationHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        threadId: options.threadId,
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
