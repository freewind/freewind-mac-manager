import { mkdtempSync, rmSync } from "node:fs"
import type { Server } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { TaskStore } from "@server/common/tasks/store"
import { TASK_REQUEST_ID_HEADER } from "@shared/api-contract"
import { ApiPath } from "@shared/api-path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { businessStore, command, migrate } = vi.hoisted(() => ({
  businessStore: vi.fn(() => {
    throw new Error("测试禁止打开业务数据库")
  }),
  command: vi.fn(() => {
    throw new Error("测试禁止执行真实命令")
  }),
  migrate: vi.fn(() => {
    throw new Error("测试禁止迁移业务数据库")
  }),
}))
vi.mock("@server/traffic/store", () => ({ TrafficStore: businessStore }))
vi.mock("@server/disk-growth/store", () => ({ DiskGrowthStore: businessStore }))
vi.mock("@server/traffic/migrate", () => ({ migrateTrafficDatabase: migrate }))
vi.mock("node:child_process", () => ({
  execFile: command,
  spawn: command,
  execFileSync: command,
}))

import { createTaskRuntime, type TaskRuntime } from "../tasks/runtime"

/**
 * 通过真实 createApp 走一遍 HTTP：协作域的挂载位置、鉴权、归属校验与
 * SSE 接线只有真正把应用搭起来才看得出来。
 * 用临时数据库（MAC_MANAGER_DB_FILE）与受控任务执行器，不碰真实业务库与命令。
 */
const TEST_PASSWORD = "test-password"
let dir: string
let runtime: TaskRuntime
let server: Server
let baseUrl: string
let savedPassword: string | undefined
let savedDbFile: string | undefined

const topicUrl = (topicId: string): string =>
  `${ApiPath.collaborationTopics}/${topicId}`
const threadsUrl = (topicId: string): string => `${topicUrl(topicId)}/threads`
const threadUrl = (topicId: string, threadId: string): string =>
  `${threadsUrl(topicId)}/${threadId}`
const commentsUrl = (topicId: string, threadId: string): string =>
  `${threadUrl(topicId, threadId)}/comments`
const commentUrl = (
  topicId: string,
  threadId: string,
  commentId: string
): string => `${commentsUrl(topicId, threadId)}/${commentId}`

const authHeaders = (
  extra: Record<string, string> = {}
): Record<string, string> => ({
  authorization: `Bearer ${TEST_PASSWORD}`,
  ...extra,
})

/** 请求标识要求 16-64 位且只含字母数字下划线连字符，这里统一生成。 */
const requestId = (tag: string): string => `${tag}-${"0".repeat(16)}`

type RequestOptions = {
  body?: unknown
  headers?: Record<string, string>
  /** 默认带鉴权；显式传 false 才不带，用于验证未认证被拒。 */
  auth?: boolean
}

const request = async (
  method: string,
  url: string,
  options: RequestOptions = {}
): Promise<{ status: number; body: unknown }> => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  }
  if (options.auth !== false) Object.assign(headers, authHeaders())
  Object.assign(headers, options.headers ?? {})
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

/** 响应体统一按 unknown 处理，在边界处显式断言形状。 */
const asBody = <T>(result: { body: unknown }): T => result.body as T

const createTopic = async (title: string): Promise<string> => {
  const result = await request("POST", ApiPath.collaborationTopics, {
    body: { title },
  })
  expect(result.status).toBe(201)
  return asBody<{ topic: { id: string } }>(result).topic.id
}

const createThread = async (
  topicId: string,
  title: string
): Promise<string> => {
  const result = await request("POST", threadsUrl(topicId), { body: { title } })
  expect(result.status).toBe(201)
  return asBody<{ thread: { id: string } }>(result).thread.id
}

beforeEach(async () => {
  savedPassword = process.env.MAC_MANAGER_PASSWORD
  savedDbFile = process.env.MAC_MANAGER_DB_FILE
  process.env.MAC_MANAGER_PASSWORD = TEST_PASSWORD
  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-collaboration-"))
  process.env.MAC_MANAGER_DB_FILE = path.join(dir, "collaboration.sqlite3")
  runtime = createTaskRuntime({
    store: new TaskStore(path.join(dir, "tasks.sqlite3")),
    recoverInterrupted: false,
    host: {
      execute: () => {
        throw new Error("测试禁止执行真实命令")
      },
    },
  })
  // env 在模块加载时读 MAC_MANAGER_DB_FILE，所以先设好再重新载入应用。
  vi.resetModules()
  const { createApp } = await import("@server/app")
  const app = createApp({ tasks: runtime, initializeBusiness: false })
  server = app.listen(0)
  await new Promise((resolve) => server.once("listening", resolve))
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve))
  runtime.runner.shutdown()
  rmSync(dir, { recursive: true, force: true })
  if (savedPassword === undefined) delete process.env.MAC_MANAGER_PASSWORD
  else process.env.MAC_MANAGER_PASSWORD = savedPassword
  if (savedDbFile === undefined) delete process.env.MAC_MANAGER_DB_FILE
  else process.env.MAC_MANAGER_DB_FILE = savedDbFile
  expect(businessStore).not.toHaveBeenCalled()
  expect(command).not.toHaveBeenCalled()
  expect(migrate).not.toHaveBeenCalled()
})

describe("协作 HTTP 端点", () => {
  it("未认证读取与订阅都被拒", async () => {
    const denied = await request("GET", ApiPath.collaborationTopics, {
      auth: false,
    })
    expect(denied.status).toBe(401)
    const sse = await fetch(`${baseUrl}${ApiPath.collaborationEvents}`, {
      headers: { accept: "text/event-stream" },
    })
    expect(sse.status).toBe(401)
  })

  it("非法参数返回 400", async () => {
    const noTitle = await request("POST", ApiPath.collaborationTopics, {
      body: {},
    })
    expect(noTitle.status).toBe(400)
    const tooLong = await request("POST", ApiPath.collaborationTopics, {
      body: { title: "x".repeat(501) },
    })
    expect(tooLong.status).toBe(400)

    const topicId = await createTopic("协作")
    const emptyUpdate = await request("PATCH", topicUrl(topicId), { body: {} })
    expect(emptyUpdate.status).toBe(400)
    const threadId = await createThread(topicId, "线程")
    const emptyThreadUpdate = await request(
      "PATCH",
      threadUrl(topicId, threadId),
      { body: {} }
    )
    expect(emptyThreadUpdate.status).toBe(400)
  })

  it("发送消息缺少请求标识返回 400", async () => {
    const topicId = await createTopic("协作")
    const threadId = await createThread(topicId, "线程")
    const missing = await request("POST", commentsUrl(topicId, threadId), {
      body: { body: "你好" },
    })
    expect(missing.status).toBe(400)
  })

  it("跨 Topic 的 threadId 与 commentId 都被拒", async () => {
    const topicA = await createTopic("A")
    const topicB = await createTopic("B")
    const threadA = await createThread(topicA, "线程")
    const threadB = await createThread(topicB, "线程")

    // 用 B 的 topicId 去访问 A 的 thread：归属不符，按不存在处理。
    const wrongThread = await request("GET", threadUrl(topicB, threadA))
    expect(wrongThread.status).toBe(404)
    // 同理，A 的 comment 不能挂在 B 的 thread 下。
    const cross = requestId("cross")
    const sent = await request("POST", commentsUrl(topicA, threadA), {
      body: { body: "你好", requestId: cross },
      headers: authHeaders({ [TASK_REQUEST_ID_HEADER]: cross }),
    })
    expect(sent.status).toBe(201)
    const commentId = asBody<{ comment: { id: string } }>(sent).comment.id
    const wrongComment = await request(
      "GET",
      commentUrl(topicB, threadB, commentId)
    )
    expect(wrongComment.status).toBe(404)
  })

  it("同一请求标识重复提交只落一条消息", async () => {
    const topicId = await createTopic("协作")
    const threadId = await createThread(topicId, "线程")
    const idem = requestId("idem")
    const headers = authHeaders({ [TASK_REQUEST_ID_HEADER]: idem })

    const first = await request("POST", commentsUrl(topicId, threadId), {
      body: { body: "你好", requestId: idem },
      headers,
    })
    expect(first.status).toBe(201)
    // 重试必须复用同一标识，且正文不同也不会产生第二条。
    const retry = await request("POST", commentsUrl(topicId, threadId), {
      body: { body: "你好（重试）" },
      headers,
    })
    expect(retry.status).toBe(200)
    expect(
      asBody<{ comment: { id: string; body: string } }>(retry).comment
    ).toEqual(asBody<{ comment: { id: string; body: string } }>(first).comment)

    const listed = await request("GET", commentsUrl(topicId, threadId))
    expect(asBody<{ comments: unknown[] }>(listed).comments).toHaveLength(1)
  })

  it("未读数只统计已读位置之后的 Agent 消息", async () => {
    const topicId = await createTopic("协作")
    const threadId = await createThread(topicId, "线程")
    let seq = 0
    const send = async (
      body: string,
      role: "user" | "agent" = "user"
    ): Promise<void> => {
      seq += 1
      const id = requestId(`m${seq}`)
      const result = await request("POST", commentsUrl(topicId, threadId), {
        body: { body, role, requestId: id },
        headers: authHeaders({ [TASK_REQUEST_ID_HEADER]: id }),
      })
      expect(result.status).toBe(201)
    }

    const empty = await request("GET", threadUrl(topicId, threadId))
    expect(
      asBody<{ thread: { userUnreadCount: number } }>(empty).thread
        .userUnreadCount
    ).toBe(0)

    await send("第一条", "agent")
    await send("第二条", "agent")
    const unread = await request("GET", threadUrl(topicId, threadId))
    expect(
      asBody<{ thread: { userUnreadCount: number } }>(unread).thread
        .userUnreadCount
    ).toBe(2)

    // 用户消息不参与未读统计。
    await send("用户消息")
    const still = await request("GET", threadUrl(topicId, threadId))
    expect(
      asBody<{ thread: { userUnreadCount: number } }>(still).thread
        .userUnreadCount
    ).toBe(2)

    // 读到第一条之后，只剩第二条未读。
    const comments = asBody<{ comments: { id: string }[] }>(unread).comments
    const read = await request("PATCH", threadUrl(topicId, threadId), {
      body: { userLastReadCommentId: comments[0].id },
    })
    expect(read.status).toBe(200)
    expect(
      asBody<{ thread: { userUnreadCount: number } }>(read).thread
        .userUnreadCount
    ).toBe(1)
  })

  it("删除 Thread 连同其 Comment，删除 Topic 连带整棵子树", async () => {
    const topicId = await createTopic("协作")
    const threadId = await createThread(topicId, "线程")
    const del = requestId("del")
    const sent = await request("POST", commentsUrl(topicId, threadId), {
      body: { body: "你好", requestId: del },
      headers: authHeaders({ [TASK_REQUEST_ID_HEADER]: del }),
    })
    expect(sent.status).toBe(201)

    const removeThread = await request("DELETE", threadUrl(topicId, threadId))
    expect(removeThread.status).toBe(204)
    expect((await request("GET", threadUrl(topicId, threadId))).status).toBe(
      404
    )
    // Thread 删掉后，它的 Comment 一并消失。
    const comments = await request("GET", commentsUrl(topicId, threadId))
    expect(comments.status).toBe(404)

    const removeTopic = await request("DELETE", topicUrl(topicId))
    expect(removeTopic.status).toBe(204)
    expect((await request("GET", topicUrl(topicId))).status).toBe(404)
  })

  it("排序只改顺序，未列出的记录排在后面", async () => {
    const ids: string[] = []
    for (const title of ["甲", "乙", "丙"]) {
      ids.push(await createTopic(title))
    }
    const reordered = await request("PATCH", ApiPath.collaborationTopics, {
      body: { orderedIds: [ids[2], ids[0]] },
    })
    expect(reordered.status).toBe(200)
    expect(
      asBody<{ topics: { id: string }[] }>(reordered).topics.map(
        (topic) => topic.id
      )
    ).toEqual([ids[2], ids[0], ids[1]])

    // 找不到的 id 被忽略，不影响其余顺序。
    const withUnknown = await request("PATCH", ApiPath.collaborationTopics, {
      body: { orderedIds: ["not-exist", ids[1]] },
    })
    expect(withUnknown.status).toBe(200)
    expect(
      asBody<{ topics: { id: string }[] }>(withUnknown).topics.map(
        (topic) => topic.id
      )
    ).toEqual([ids[1], ids[2], ids[0]])
  })

  it("搜索只读，命中标题与正文", async () => {
    const topicId = await createTopic("发布计划")
    const threadId = await createThread(topicId, "周一例会")
    const search = requestId("search")
    await request("POST", commentsUrl(topicId, threadId), {
      body: { body: "讨论预算", requestId: search },
      headers: authHeaders({ [TASK_REQUEST_ID_HEADER]: search }),
    })

    const hit = await request("GET", `${ApiPath.collaborationSearch}?q=预算`)
    expect(hit.status).toBe(200)
    const hitBody = asBody<{ comments: { topicId: string }[] }>(hit)
    expect(hitBody.comments).toHaveLength(1)
    expect(hitBody.comments[0].topicId).toBe(topicId)

    const miss = await request("GET", `${ApiPath.collaborationSearch}?q=不存在`)
    expect(miss.status).toBe(200)
    expect(asBody<{ topics: unknown[] }>(miss).topics).toHaveLength(0)
    expect(asBody<{ threads: unknown[] }>(miss).threads).toHaveLength(0)
    expect(asBody<{ comments: unknown[] }>(miss).comments).toHaveLength(0)

    const bad = await request("GET", ApiPath.collaborationSearch)
    expect(bad.status).toBe(400)
  })

  it("SSE 收到变更事件，断线后重新读取拿到全量", async () => {
    const topicId = await createTopic("协作")
    const stream = await openSse()

    const threadId = await createThread(topicId, "线程")
    const sse = requestId("sse")
    const sent = await request("POST", commentsUrl(topicId, threadId), {
      body: { body: "你好", requestId: sse },
      headers: authHeaders({ [TASK_REQUEST_ID_HEADER]: sse }),
    })
    expect(sent.status).toBe(201)

    await waitFor(() =>
      stream.events.some((event) => event.type === "thread_created")
    )
    const change = stream.events.find(
      (event) => event.type === "comment_created"
    )
    expect(change?.commentId).toBe(
      asBody<{ comment: { id: string } }>(sent).comment.id
    )

    // 断线：事件可以不丢（这里已收到），但真相仍然只能来自读取接口。
    stream.close()
    const detail = await request("GET", threadUrl(topicId, threadId))
    expect(detail.status).toBe(200)
    expect(asBody<{ comments: unknown[] }>(detail).comments).toHaveLength(1)
    // 用户消息不参与未读统计，所以这里是 0。
    expect(
      asBody<{ thread: { userUnreadCount: number } }>(detail).thread
        .userUnreadCount
    ).toBe(0)
  })
})

/** SSE 事件形状：只带定位信息，不带业务数据。 */
type SseEvent = {
  type: string
  topicId?: string
  threadId?: string
  commentId?: string
}

/** 打开 SSE 订阅：返回事件收集器与主动断线方法。 */
const openSse = async (): Promise<{
  events: SseEvent[]
  close: () => void
}> => {
  const controller = new AbortController()
  const response = await fetch(`${baseUrl}${ApiPath.collaborationEvents}`, {
    headers: authHeaders({ accept: "text/event-stream" }),
    signal: controller.signal,
  })
  if (!response.body) throw new Error("协作事件订阅没有响应体")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const events: SseEvent[] = []
  let buffer = ""
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop() ?? ""
        for (const block of blocks) {
          const dataLine = block
            .split(/\r?\n/)
            .find((line) => line.startsWith("data:"))
          if (!dataLine) continue
          events.push(JSON.parse(dataLine.slice(5).trim()) as SseEvent)
        }
      }
    } catch {
      // 主动断线会中止读取：这是预期行为，不是错误。
    }
  })()
  return { events, close: () => controller.abort() }
}

/** 轮询等待条件成立：SSE 是异步到达的，不能假定同一 tick 内就位。 */
const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let index = 0; index < 200; index += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("等待 SSE 事件超时")
}
