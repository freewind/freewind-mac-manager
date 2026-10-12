import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type {
  CollaborationComment,
  CollaborationThreadRecord,
  CollaborationTopicRecord,
} from "@shared/api-contract/schemas/collaboration"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  CollaborationStore,
  computeUserUnreadCount,
  formatThreadLink,
} from "./store"

let dir: string
let file: string
let store: CollaborationStore

beforeEach(() => {
  // 单元测试只写临时数据库，绝不碰真实记录。
  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-collaboration-"))
  file = path.join(dir, "collaboration.sqlite3")
  store = new CollaborationStore(file)
})

afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

const topic = (
  overrides: Partial<CollaborationTopicRecord> = {}
): CollaborationTopicRecord => ({
  id: "topic-1",
  title: "中文主题",
  createdAt: "2026-01-01T00:00:00.000Z",
  completedAt: null,
  createdByAgent: "user",
  agentNotifyUrl: null,
  agentNotifyEnabled: null,
  position: 0,
  ...overrides,
})

const thread = (
  overrides: Partial<CollaborationThreadRecord> = {}
): CollaborationThreadRecord => ({
  id: "thread-1",
  topicId: "topic-1",
  title: "线程",
  createdAt: "2026-01-01T00:00:01.000Z",
  completedAt: null,
  createdByAgent: null,
  userLastReadCommentId: null,
  position: 0,
  ...overrides,
})

const comment = (
  overrides: Partial<CollaborationComment> = {}
): CollaborationComment => ({
  id: "comment-1",
  threadId: "thread-1",
  role: "user",
  body: "正文",
  createdAt: "2026-01-01T00:00:02.000Z",
  updatedAt: null,
  readByAgent: null,
  authorAgent: null,
  position: 0,
  ...overrides,
})

describe("collaboration store", () => {
  it("往返保存全部字段，缺省字段落成 null", () => {
    store.insertTopic(topic({ agentNotifyUrl: "http://localhost:1" }))
    store.insertThread(thread())
    store.insertComment(comment())

    expect(store.findTopic("topic-1")).toEqual(
      topic({ agentNotifyUrl: "http://localhost:1" })
    )
    expect(store.findThread("thread-1")).toEqual(thread())
    expect(store.findComment("comment-1")).toEqual(comment())
  })

  it("区分 false 与缺省：false 落库为 false，缺省读回 null", () => {
    store.insertTopic(
      topic({
        agentNotifyEnabled: false,
        completedAt: "2026-02-01T00:00:00.000Z",
      })
    )
    expect(store.findTopic("topic-1")).toMatchObject({
      agentNotifyEnabled: false,
      completedAt: "2026-02-01T00:00:00.000Z",
    })

    store.insertTopic(topic({ id: "topic-2", position: 1 }))
    expect(store.findTopic("topic-2")?.agentNotifyEnabled).toBeNull()
  })

  it("按显式 position 还原源项目的数组顺序，而不是插入顺序", () => {
    store.insertTopic(topic({ id: "topic-b", position: 0 }))
    store.insertTopic(topic({ id: "topic-a", position: 1 }))
    store.insertThread(thread({ id: "thread-b", position: 0 }))
    store.insertThread(thread({ id: "thread-a", position: 1 }))
    store.insertComment(comment({ id: "comment-b", position: 0 }))
    store.insertComment(comment({ id: "comment-a", position: 1 }))

    expect(store.listTopics().map((item) => item.id)).toEqual([
      "topic-b",
      "topic-a",
    ])
    expect(store.listThreads("topic-1").map((item) => item.id)).toEqual([
      "thread-b",
      "thread-a",
    ])
    expect(store.listComments("thread-1").map((item) => item.id)).toEqual([
      "comment-b",
      "comment-a",
    ])
  })

  it("现算未读数：null 全算、有效位置之后、失效位置为 0", () => {
    const comments: CollaborationComment[] = [
      comment({ id: "c1", role: "agent", position: 0 }),
      comment({ id: "c2", role: "user", position: 1 }),
      comment({ id: "c3", role: "agent", position: 2 }),
    ]
    expect(computeUserUnreadCount(comments, null)).toBe(2)
    expect(computeUserUnreadCount(comments, "c1")).toBe(1)
    expect(computeUserUnreadCount(comments, "c3")).toBe(0)
    expect(computeUserUnreadCount(comments, "missing")).toBe(0)
  })

  it("listThreads 把未读与跳转链接作为派生值返回，不落库", () => {
    store.insertTopic(topic())
    store.insertThread(thread({ userLastReadCommentId: "c1" }))
    store.insertComment(comment({ id: "c1", role: "agent", position: 0 }))
    store.insertComment(comment({ id: "c2", role: "agent", position: 1 }))

    expect(store.listThreads("topic-1")).toEqual([
      {
        ...thread({ userLastReadCommentId: "c1" }),
        userUnreadCount: 1,
        link: formatThreadLink("线程", "thread-1"),
      },
    ])
  })

  it("listTopics 汇总线程数与未读合计", () => {
    store.insertTopic(topic())
    store.insertThread(thread({ id: "thread-1", position: 0 }))
    store.insertThread(
      thread({ id: "thread-2", position: 1, userLastReadCommentId: "x1" })
    )
    store.insertComment(comment({ id: "c1", role: "agent" }))
    store.insertComment(
      comment({ id: "x1", threadId: "thread-2", role: "agent" })
    )
    store.insertComment(
      comment({ id: "x2", threadId: "thread-2", role: "agent", position: 1 })
    )

    expect(store.listTopics()).toEqual([
      {
        ...topic(),
        threadCount: 2,
        // thread-1 从未读过 → 1 条 agent；thread-2 已读到 x1 → x2 未读 1 条
        userUnreadCount: 2,
      },
    ])
  })

  it("事务内抛错整体回滚，不留半批数据", () => {
    expect(() =>
      store.transaction(() => {
        store.insertTopic(topic())
        store.insertThread(thread())
        throw new Error("模拟中途失败")
      })
    ).toThrow("模拟中途失败")
    expect(store.counts()).toEqual({ topics: 0, threads: 0, comments: 0 })
  })

  it("关闭后重开仍能读回已写入的记录", () => {
    store.insertTopic(topic())
    store.close()
    store = new CollaborationStore(file)
    expect(store.findTopic("topic-1")).toEqual(topic())
  })

  it("counts 统计三张表", () => {
    store.insertTopic(topic())
    store.insertThread(thread())
    store.insertComment(comment())
    expect(store.counts()).toEqual({ topics: 1, threads: 1, comments: 1 })
  })
})
