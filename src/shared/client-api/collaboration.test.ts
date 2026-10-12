import { TASK_REQUEST_ID_HEADER } from "@shared/api-contract"
import { ApiPath } from "@shared/api-path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { apiClient } from "./client"
import {
  createCollaborationTopic,
  fetchCollaborationThread,
  fetchCollaborationTopics,
  reorderCollaborationTopics,
  searchCollaboration,
  sendCollaborationComment,
  subscribeCollaborationEvents,
} from "./collaboration"

/**
 * 客户端契约测试：验证具名调用拼出正确的方法、路径、参数与请求头。
 * 不启动服务，直接对 apiClient 打替身。
 */
const ok = <T>(body: T): { status: 200; body: T; headers: Headers } => ({
  status: 200,
  body,
  headers: new Headers(),
})

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("协作客户端读取", () => {
  it("fetchCollaborationTopics 调用列表接口", async () => {
    const spy = vi
      .spyOn(apiClient, "listCollaborationTopics")
      .mockResolvedValue(ok({ topics: [] }))
    await expect(fetchCollaborationTopics()).resolves.toEqual({ topics: [] })
    expect(spy).toHaveBeenCalledWith()
  })

  it("fetchCollaborationThread 带上路径参数", async () => {
    const spy = vi
      .spyOn(apiClient, "getCollaborationThread")
      .mockResolvedValue(ok({ thread: {}, comments: [] } as never))
    await fetchCollaborationThread({ topicId: "topic-1", threadId: "thread-1" })
    expect(spy).toHaveBeenCalledWith({
      params: { topicId: "topic-1", threadId: "thread-1" },
    })
  })

  it("searchCollaboration 把 q 放进 query", async () => {
    const spy = vi
      .spyOn(apiClient, "searchCollaboration")
      .mockResolvedValue(ok({ topics: [], threads: [], comments: [] }))
    await searchCollaboration({ q: "预算" })
    expect(spy).toHaveBeenCalledWith({ query: { q: "预算" } })
  })
})

describe("协作客户端写入", () => {
  it("createCollaborationTopic 转发请求体", async () => {
    const spy = vi
      .spyOn(apiClient, "createCollaborationTopic")
      .mockResolvedValue(ok({ topic: {}, threads: [] }))
    await createCollaborationTopic({ title: "发布计划" })
    expect(spy).toHaveBeenCalledWith({ body: { title: "发布计划" } })
  })

  it("reorderCollaborationTopics 转发有序 id 列表", async () => {
    const spy = vi
      .spyOn(apiClient, "reorderCollaborationTopics")
      .mockResolvedValue(ok({ topics: [] }))
    await reorderCollaborationTopics({ orderedIds: ["topic-1", "topic-2"] })
    expect(spy).toHaveBeenCalledWith({
      body: { orderedIds: ["topic-1", "topic-2"] },
    })
  })

  it("sendCollaborationComment 带上请求标识请求头", async () => {
    const spy = vi
      .spyOn(apiClient, "sendCollaborationComment")
      .mockResolvedValue(ok({ comment: {} } as never))
    await sendCollaborationComment(
      { topicId: "topic-1", threadId: "thread-1" },
      { body: "你好", requestId: "req-1" }
    )
    expect(spy).toHaveBeenCalledWith({
      params: { topicId: "topic-1", threadId: "thread-1" },
      body: { body: "你好", requestId: "req-1" },
      headers: { [TASK_REQUEST_ID_HEADER]: "req-1" },
    })
  })
})

describe("协作事件订阅", () => {
  it("解析 ready 与 change 帧，并带上鉴权头与 SSE Accept", async () => {
    const payload = [
      "event: ready",
      "data: {}",
      "",
      "event: change",
      'data: {"type":"topic_created","topicId":"topic-1"}',
      "",
      "",
    ].join("\n")
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(payload))
    const onEvent = vi.fn()

    await subscribeCollaborationEvents({
      signal: new AbortController().signal,
      onEvent,
    })

    expect(fetchSpy).toHaveBeenCalledWith(
      ApiPath.collaborationEvents,
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: "text/event-stream" }),
      })
    )
    expect(onEvent).toHaveBeenNthCalledWith(1, { type: "ready" })
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      type: "change",
      event: { type: "topic_created", topicId: "topic-1" },
    })
    expect(onEvent).toHaveBeenCalledTimes(2)
  })

  it("解析失败的帧被跳过，不影响后续事件", async () => {
    const payload = [
      "event: change",
      "data: not-json",
      "",
      "event: change",
      'data: {"type":"topics_reordered"}',
      "",
      "",
    ].join("\n")
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(payload))
    const onEvent = vi.fn()

    await subscribeCollaborationEvents({
      signal: new AbortController().signal,
      onEvent,
    })

    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith({
      type: "change",
      event: { type: "topics_reordered" },
    })
  })
})
