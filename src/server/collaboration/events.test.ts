import type { CollaborationEvent } from "@shared/api-contract/schemas/collaboration"
import { ApiPath } from "@shared/api-path"
import type express from "express"
import { describe, expect, it, vi } from "vitest"
import {
  publishCollaborationEvent,
  registerCollaborationEventEndpoint,
  subscribeCollaborationEvents,
} from "./events"

/** 只实现端点用到的 response 方法：记录头部、数据帧与事件监听器。 */
const createFakeResponse = () => {
  const headers: Record<string, string> = {}
  const chunks: string[] = []
  const listeners = new Map<string, () => void>()
  return {
    setHeader: (name: string, value: string) => {
      headers[name] = value
    },
    flushHeaders: () => {},
    write: (chunk: string) => {
      chunks.push(chunk)
    },
    on: (event: string, listener: () => void) => {
      listeners.set(event, listener)
    },
    headers,
    chunks,
    listeners,
  }
}

describe("协作事件总线", () => {
  it("发布后订阅者收到事件，取消订阅后不再收到", () => {
    const received: CollaborationEvent[] = []
    const unsubscribe = subscribeCollaborationEvents((event) =>
      received.push(event)
    )
    publishCollaborationEvent({ type: "topic_created", topicId: "topic-1" })
    publishCollaborationEvent({ type: "topics_reordered" })
    expect(received).toEqual([
      { type: "topic_created", topicId: "topic-1" },
      { type: "topics_reordered" },
    ])

    unsubscribe()
    publishCollaborationEvent({ type: "topic_deleted", topicId: "topic-1" })
    expect(received).toHaveLength(2)
  })
})

describe("协作 SSE 端点", () => {
  it("写入 ready 与 change 帧，断线时解除订阅", () => {
    let handler: ((request: unknown, response: unknown) => void) | undefined
    const app = {
      get: (
        path: string,
        fn: (request: unknown, response: unknown) => void
      ) => {
        if (path !== ApiPath.collaborationEvents) throw new Error("路径不匹配")
        handler = fn
      },
    }
    registerCollaborationEventEndpoint(app as unknown as express.Express)
    if (handler === undefined) throw new Error("端点未注册")

    const response = createFakeResponse()
    handler(undefined, response)
    expect(response.headers["Content-Type"]).toBe("text/event-stream")
    expect(response.chunks[0]).toBe("event: ready\ndata: {}\n\n")

    const subscribed = vi.fn()
    subscribeCollaborationEvents(subscribed)
    publishCollaborationEvent({
      type: "comment_created",
      topicId: "topic-1",
      threadId: "thread-1",
      commentId: "comment-1",
    })
    const expected = JSON.stringify({
      type: "comment_created",
      topicId: "topic-1",
      threadId: "thread-1",
      commentId: "comment-1",
    })
    expect(response.chunks).toHaveLength(2)
    expect(response.chunks[1]).toBe(`event: change\ndata: ${expected}\n\n`)

    // 断线只解除端点的订阅：不再写帧；总线本身仍然正常工作。
    const onClose = response.listeners.get("close")
    if (onClose === undefined) throw new Error("断线监听器未注册")
    onClose()
    publishCollaborationEvent({ type: "topic_deleted", topicId: "topic-1" })
    expect(response.chunks).toHaveLength(2)
    expect(subscribed).toHaveBeenCalledTimes(2)
  })
})
