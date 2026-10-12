import type {
  CollaborationCommentList,
  CollaborationCommentPath,
  CollaborationCommentResponse,
  CollaborationCreateThread,
  CollaborationCreateTopic,
  CollaborationEditComment,
  CollaborationEvent,
  CollaborationReorder,
  CollaborationSearchQuery,
  CollaborationSearchResult,
  CollaborationThreadDetail,
  CollaborationThreadList,
  CollaborationThreadPath,
  CollaborationTopicDetail,
  CollaborationTopicList,
  CollaborationTopicPath,
  CollaborationUpdateThread,
  CollaborationUpdateTopic,
} from "@shared/api-contract"
import { CollaborationEventSchema } from "@shared/api-contract/schemas/collaboration"
import { ApiPath } from "@shared/api-path"
import { buildAuthorizationHeader } from "./access-password"
import {
  ApiRequestError,
  apiClient,
  assertWriteOnline,
  dispatchUnauthorized,
  taskRequestHeaders,
  unwrap,
} from "./client"

// ---------- 读取 ----------

export const fetchCollaborationTopics =
  async (): Promise<CollaborationTopicList> =>
    unwrap(await apiClient.listCollaborationTopics())

export const fetchCollaborationTopic = async (
  params: CollaborationTopicPath
): Promise<CollaborationTopicDetail> =>
  unwrap(await apiClient.getCollaborationTopic({ params }))

export const fetchCollaborationThreads = async (
  params: CollaborationTopicPath
): Promise<CollaborationThreadList> =>
  unwrap(await apiClient.listCollaborationThreads({ params }))

export const fetchCollaborationThread = async (
  params: CollaborationThreadPath
): Promise<CollaborationThreadDetail> =>
  unwrap(await apiClient.getCollaborationThread({ params }))

export const fetchCollaborationComments = async (
  params: CollaborationThreadPath
): Promise<CollaborationCommentList> =>
  unwrap(await apiClient.listCollaborationComments({ params }))

export const searchCollaboration = async (
  query: CollaborationSearchQuery
): Promise<CollaborationSearchResult> =>
  unwrap(await apiClient.searchCollaboration({ query }))

// ---------- 写入 ----------

export const createCollaborationTopic = async (
  input: CollaborationCreateTopic
): Promise<CollaborationTopicDetail> => {
  assertWriteOnline()
  return unwrap(await apiClient.createCollaborationTopic({ body: input }))
}

export const updateCollaborationTopic = async (
  params: CollaborationTopicPath,
  input: CollaborationUpdateTopic
): Promise<CollaborationTopicDetail> => {
  assertWriteOnline()
  return unwrap(
    await apiClient.updateCollaborationTopic({ params, body: input })
  )
}

export const deleteCollaborationTopic = async (
  params: CollaborationTopicPath
): Promise<void> => {
  assertWriteOnline()
  await apiClient.deleteCollaborationTopic({ params })
}

export const reorderCollaborationTopics = async (
  input: CollaborationReorder
): Promise<CollaborationTopicList> => {
  assertWriteOnline()
  return unwrap(await apiClient.reorderCollaborationTopics({ body: input }))
}

export const createCollaborationThread = async (
  params: CollaborationTopicPath,
  input: CollaborationCreateThread
): Promise<CollaborationThreadDetail> => {
  assertWriteOnline()
  return unwrap(
    await apiClient.createCollaborationThread({ params, body: input })
  )
}

export const updateCollaborationThread = async (
  params: CollaborationThreadPath,
  input: CollaborationUpdateThread
): Promise<CollaborationThreadDetail> => {
  assertWriteOnline()
  return unwrap(
    await apiClient.updateCollaborationThread({ params, body: input })
  )
}

export const deleteCollaborationThread = async (
  params: CollaborationThreadPath
): Promise<void> => {
  assertWriteOnline()
  await apiClient.deleteCollaborationThread({ params })
}

export const reorderCollaborationThreads = async (
  params: CollaborationTopicPath,
  input: CollaborationReorder
): Promise<CollaborationThreadList> => {
  assertWriteOnline()
  return unwrap(
    await apiClient.reorderCollaborationThreads({ params, body: input })
  )
}

/**
 * 发送消息。requestId 由调用方生成并保存：网络重试复用同一标识，
 * 服务端据此保证「同一请求标识只落一条消息」。
 */
export const sendCollaborationComment = async (
  params: CollaborationThreadPath,
  input: {
    body: string
    role?: "user" | "agent"
    authorAgent?: string
    readByAgent?: boolean
    requestId: string
  }
): Promise<CollaborationCommentResponse> => {
  assertWriteOnline()
  return unwrap(
    await apiClient.sendCollaborationComment({
      params,
      body: input,
      headers: taskRequestHeaders(input.requestId),
    })
  )
}

export const updateCollaborationComment = async (
  params: CollaborationCommentPath,
  input: CollaborationEditComment
): Promise<CollaborationCommentResponse> => {
  assertWriteOnline()
  return unwrap(
    await apiClient.updateCollaborationComment({ params, body: input })
  )
}

export const deleteCollaborationComment = async (
  params: CollaborationCommentPath
): Promise<void> => {
  assertWriteOnline()
  await apiClient.deleteCollaborationComment({ params })
}

// ---------- 事件订阅（SSE） ----------

export type CollaborationStreamEvent =
  | { type: "ready" }
  | { type: "change"; event: CollaborationEvent }

type SseFrame = { event: string; data: string }

/**
 * 极简 SSE 分帧：按空行切分事件块，逐行取 event / data。
 * 只覆盖本端点用到的 ready / change 两种帧，不实现注释、重连与多行 data 合并以外的能力。
 */
const parseSseFrames = (
  buffer: string
): { events: SseFrame[]; rest: string } => {
  const blocks = buffer.split(/\r?\n\r?\n/)
  const rest = blocks.pop() ?? ""
  const events: SseFrame[] = []
  for (const block of blocks) {
    let event = "message"
    const dataLines: string[] = []
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(":")) continue
      const separator = line.indexOf(":")
      const field = separator === -1 ? line : line.slice(0, separator)
      const value =
        separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "")
      if (field === "event") event = value
      else if (field === "data") dataLines.push(value)
    }
    if (dataLines.length > 0) events.push({ event, data: dataLines.join("\n") })
  }
  return { events, rest }
}

/**
 * 订阅协作变更事件。
 *
 * 事件只说明「哪里变了」，不是真相来源：收到 change 后必须重新读取真实数据。
 * 因此这里不做本地状态合并，也不在断开时补发丢失事件。
 */
export const subscribeCollaborationEvents = async (options: {
  signal: AbortSignal
  onEvent: (event: CollaborationStreamEvent) => void
}): Promise<void> => {
  const response = await fetch(ApiPath.collaborationEvents, {
    headers: { ...buildAuthorizationHeader(), Accept: "text/event-stream" },
    signal: options.signal,
  })
  if (response.status === 401) dispatchUnauthorized()
  if (!response.ok) {
    throw new ApiRequestError(
      `协作事件订阅失败：HTTP ${response.status}`,
      response.status
    )
  }
  if (!response.body) {
    throw new ApiRequestError("协作事件订阅没有响应体", response.status)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    const frames = parseSseFrames(buffer)
    buffer = frames.rest
    for (const frame of frames.events) {
      if (frame.event === "ready") {
        options.onEvent({ type: "ready" })
        continue
      }
      if (frame.event !== "change") continue
      try {
        const parsed = CollaborationEventSchema.safeParse(
          JSON.parse(frame.data)
        )
        if (parsed.success) {
          options.onEvent({ type: "change", event: parsed.data })
        }
      } catch {
        // 单帧解析失败不影响后续事件；事件本就不是真相来源。
      }
    }
  }
}
