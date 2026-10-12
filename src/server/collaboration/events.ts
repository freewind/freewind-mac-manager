import type { CollaborationEvent } from "@shared/api-contract/schemas/collaboration"
import { ApiPath } from "@shared/api-path"
import type express from "express"

type Listener = (event: CollaborationEvent) => void

/**
 * 进程内事件总线。事件只说「哪里变了」，不携带业务数据，
 * 客户端收到后必须重新读取真实数据，因此总线不承担任何一致性职责。
 */
const listeners = new Set<Listener>()

export const publishCollaborationEvent = (event: CollaborationEvent): void => {
  for (const listener of listeners) listener(event)
}

export const subscribeCollaborationEvents = (
  listener: Listener
): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** SSE 事件帧：通知型事件（type: change）携带真正的 CollaborationEvent。 */
export const COLLABORATION_SSE_EVENT = "change"

/**
 * SSE 订阅端点。
 *
 * SSE 是传输例外：它不属于 ts-rest 契约，原因有三：
 * 1. 事件不是真相来源，只是「有变更」的通知，客户端必须回读真实数据；
 * 2. HTTP 状态码在这里没有路由语义（长连接只建立一次）；
 * 3. 契约面向有请求-响应的请求，而长连接是异步通道，放在契约里会误导调用方。
 *
 * 因此这里只做最薄的管道：鉴权由 auth 中间件保证，路径直接用 ApiPath。
 */
export const registerCollaborationEventEndpoint = (
  app: express.Express
): void => {
  app.get(ApiPath.collaborationEvents, (_request, response) => {
    response.setHeader("Content-Type", "text/event-stream")
    response.setHeader("Cache-Control", "no-cache")
    response.setHeader("Connection", "keep-alive")
    response.flushHeaders()
    response.write("event: ready\ndata: {}\n\n")

    const unsubscribe = subscribeCollaborationEvents((event) => {
      response.write(
        `event: ${COLLABORATION_SSE_EVENT}\ndata: ${JSON.stringify(event)}\n\n`
      )
    })

    // 断线只解除订阅：事件丢失可以接受，数据由客户端重新读取。
    response.on("close", () => {
      unsubscribe()
    })
  })
}
