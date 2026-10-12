import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { AgentHubData } from "@shared/api-contract/schemas/collaboration"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { importAgentHubData } from "./import"
import { CollaborationStore } from "./store"

let dir: string
let store: CollaborationStore

beforeEach(() => {
  // 导入测试只写临时数据库，绝不碰真实记录。
  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-import-"))
  store = new CollaborationStore(path.join(dir, "collaboration.sqlite3"))
})

afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

/**
 * 夹具覆盖：中文正文、被编辑过的消息（updatedAt）、已完成的 Thread、
 * 失效的 userLastReadCommentId、自定义排序、agent 消息作者名，
 * 以及 readByAgent 的 true / false / 缺省三种状态。
 */
const makeFixture = (): AgentHubData => ({
  updatedAt: "2026-10-12T08:52:26.018Z",
  topics: [
    {
      id: "topic-b",
      title: "第二个主题",
      createdAt: "2026-02-01T00:00:00.000Z",
      createdByAgent: "user",
      agentNotifyUrl: "http://localhost:12345",
      agentNotifyEnabled: true,
      threads: [
        {
          id: "thread-3",
          title: "中文线程",
          createdAt: "2026-02-01T00:00:01.000Z",
          createdByAgent: "user",
          userLastReadCommentId: null,
          comments: [
            {
              id: "c-3a",
              role: "user",
              body: "用户问题",
              createdAt: "2026-02-01T00:00:02.000Z",
              readByAgent: true,
            },
            {
              id: "c-3b",
              role: "agent",
              body: "Agent 回答",
              createdAt: "2026-02-01T00:00:03.000Z",
              authorAgent: "LongCat-2.0 (sub)",
            },
          ],
        },
      ],
    },
    {
      id: "topic-a",
      title: "第一个主题",
      createdAt: "2026-01-01T00:00:00.000Z",
      threads: [
        {
          id: "thread-2",
          title: "失效的已读位置",
          createdAt: "2026-01-01T00:00:01.000Z",
          createdByAgent: "user",
          userLastReadCommentId: "c-missing",
          comments: [
            {
              id: "c-2a",
              role: "agent",
              body: "A",
              createdAt: "2026-01-01T00:00:02.000Z",
            },
            {
              id: "c-2b",
              role: "agent",
              body: "B",
              createdAt: "2026-01-01T00:00:03.000Z",
            },
          ],
        },
        {
          id: "thread-1",
          title: "已完成的线程",
          createdAt: "2026-01-01T00:00:04.000Z",
          completedAt: "2026-03-01T00:00:00.000Z",
          createdByAgent: "user",
          userLastReadCommentId: "c-1b",
          comments: [
            {
              id: "c-1a",
              role: "user",
              body: "原始消息",
              createdAt: "2026-01-01T00:00:05.000Z",
              readByAgent: true,
            },
            {
              id: "c-1b",
              role: "agent",
              body: "回答",
              createdAt: "2026-01-01T00:00:06.000Z",
              authorAgent: "Composer 2.5 Fast",
            },
            {
              id: "c-1c",
              role: "user",
              body: "被编辑过的消息",
              createdAt: "2026-01-01T00:00:07.000Z",
              updatedAt: "2026-01-02T00:00:00.000Z",
              readByAgent: false,
            },
          ],
        },
      ],
    },
  ],
})

describe("importAgentHubData", () => {
  it("首次导入逐字段一致，并还原顺序与派生值", () => {
    const result = importAgentHubData(store, makeFixture())

    expect(result.topics).toEqual({ inserted: 2, skipped: 0, conflicted: 0 })
    expect(result.threads).toEqual({ inserted: 3, skipped: 0, conflicted: 0 })
    expect(result.comments).toEqual({ inserted: 7, skipped: 0, conflicted: 0 })
    expect(result.conflicts).toEqual([])
    expect(result.renames).toEqual([])

    // 顺序：数组顺序即显示顺序，position 显式保存
    expect(store.listTopics().map((item) => item.id)).toEqual([
      "topic-b",
      "topic-a",
    ])
    expect(store.listThreads("topic-a").map((item) => item.id)).toEqual([
      "thread-2",
      "thread-1",
    ])
    expect(store.listComments("thread-1").map((item) => item.id)).toEqual([
      "c-1a",
      "c-1b",
      "c-1c",
    ])

    // 逐字段：Topic（含源数据真实字段与缺省转 null）
    expect(store.findTopic("topic-b")).toEqual({
      id: "topic-b",
      title: "第二个主题",
      createdAt: "2026-02-01T00:00:00.000Z",
      completedAt: null,
      createdByAgent: "user",
      agentNotifyUrl: "http://localhost:12345",
      agentNotifyEnabled: true,
      position: 0,
    })
    expect(store.findTopic("topic-a")).toEqual({
      id: "topic-a",
      title: "第一个主题",
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      createdByAgent: null,
      agentNotifyUrl: null,
      agentNotifyEnabled: null,
      position: 1,
    })

    // 逐字段：Thread（完成状态、作者、已读位置）
    expect(store.findThread("thread-1")).toEqual({
      id: "thread-1",
      topicId: "topic-a",
      title: "已完成的线程",
      createdAt: "2026-01-01T00:00:04.000Z",
      completedAt: "2026-03-01T00:00:00.000Z",
      createdByAgent: "user",
      userLastReadCommentId: "c-1b",
      position: 1,
    })
    expect(store.findThread("thread-2")?.userLastReadCommentId).toBe(
      "c-missing"
    )
    expect(store.findThread("thread-3")?.userLastReadCommentId).toBeNull()

    // 逐字段：Comment（正文、时间、作者、编辑时间、已读状态）
    expect(store.findComment("c-1c")).toEqual({
      id: "c-1c",
      threadId: "thread-1",
      role: "user",
      body: "被编辑过的消息",
      createdAt: "2026-01-01T00:00:07.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      readByAgent: false,
      authorAgent: null,
      position: 2,
    })
    expect(store.findComment("c-1b")?.authorAgent).toBe("Composer 2.5 Fast")
    expect(store.findComment("c-3a")?.readByAgent).toBe(true)
    // 源数据缺省 readByAgent → 落成 null，不冒充 false
    expect(store.findComment("c-3b")?.readByAgent).toBeNull()

    // 派生值：失效的已读位置按 0 未读处理，从未读过则全部 agent 评论未读
    const threads = store.listThreads("topic-a")
    expect(
      threads.find((item) => item.id === "thread-2")?.userUnreadCount
    ).toBe(0)
    expect(threads.find((item) => item.id === "thread-1")?.link).toBe(
      "[已完成的线程](#thread:thread-1)"
    )
    expect(
      store.listTopics().find((item) => item.id === "topic-b")
    ).toMatchObject({ threadCount: 1, userUnreadCount: 1 })
  })

  it("非法输入被拒，不产生任何写入", () => {
    const invalid = {
      topics: [
        {
          id: "topic-x",
          title: "标题",
          createdAt: "2026-01-01T00:00:00.000Z",
          threads: [
            {
              id: "thread-x",
              title: "线程",
              createdAt: "2026-01-01T00:00:00.000Z",
              comments: [
                {
                  id: "comment-x",
                  role: "system",
                  body: "非法角色",
                  createdAt: "2026-01-01T00:00:00.000Z",
                },
              ],
            },
          ],
        },
      ],
    }
    expect(() => importAgentHubData(store, invalid)).toThrow(
      "不符合 agent-hub 的 db.json 形状"
    )
    expect(store.counts()).toEqual({ topics: 0, threads: 0, comments: 0 })

    expect(() => importAgentHubData(store, {})).toThrow(
      "不符合 agent-hub 的 db.json 形状"
    )
    expect(store.counts()).toEqual({ topics: 0, threads: 0, comments: 0 })
  })

  it("中途失败整体回滚，不留半批数据", () => {
    const original = store.insertComment.bind(store)
    let calls = 0
    vi.spyOn(store, "insertComment").mockImplementation((record) => {
      calls += 1
      if (calls === 2) throw new Error("模拟写入失败")
      original(record)
    })

    expect(() => importAgentHubData(store, makeFixture())).toThrow(
      "模拟写入失败"
    )
    expect(store.counts()).toEqual({ topics: 0, threads: 0, comments: 0 })
  })

  it("重复导入同一份数据不产生重复记录", () => {
    const first = importAgentHubData(store, makeFixture())
    const second = importAgentHubData(store, makeFixture())

    expect(first.topics.inserted).toBe(2)
    expect(second.topics).toEqual({ inserted: 0, skipped: 2, conflicted: 0 })
    expect(second.threads).toEqual({ inserted: 0, skipped: 3, conflicted: 0 })
    expect(second.comments).toEqual({ inserted: 0, skipped: 7, conflicted: 0 })
    expect(second.conflicts).toEqual([])
    expect(second.renames).toEqual([])
    expect(store.counts()).toEqual({ topics: 2, threads: 3, comments: 7 })
  })

  it("同批内重复 id 改名保留，两条正文都在且重复导入幂等", () => {
    // 源数据里真实出现过：未展开的 shell 替换被当成 id，
    // 同一个 Thread 里有两条 id 相同、正文不同的消息。
    const dupId = "tm-$(date +%s)"
    const fixture: AgentHubData = {
      topics: [
        {
          id: "topic-dup",
          title: "重复 id",
          createdAt: "2026-07-25T00:00:00.000Z",
          threads: [
            {
              id: "thread-dup",
              title: "自由讨论",
              createdAt: "2026-07-25T00:00:01.000Z",
              comments: [
                {
                  id: dupId,
                  role: "agent",
                  body: "第一条正文",
                  createdAt: "2026-07-25T00:00:02.000Z",
                },
                {
                  id: dupId,
                  role: "agent",
                  body: "第二条正文",
                  createdAt: "2026-07-25T00:00:03.000Z",
                },
              ],
            },
          ],
        },
      ],
    }

    const first = importAgentHubData(store, fixture)
    expect(first.comments).toEqual({ inserted: 2, skipped: 0, conflicted: 0 })
    expect(first.conflicts).toEqual([])
    expect(first.renames).toEqual([
      { kind: "comment", originalId: dupId, newId: `${dupId}#dup2` },
    ])

    // 两条正文都保留，id 确定可复现，位置仍是原顺序
    const comments = store.listComments("thread-dup")
    expect(comments.map((item) => item.id)).toEqual([dupId, `${dupId}#dup2`])
    expect(comments.map((item) => item.body)).toEqual([
      "第一条正文",
      "第二条正文",
    ])
    expect(comments.map((item) => item.position)).toEqual([0, 1])

    // 规则只看输入本身：再次导入算出同样的 id，全部命中「已存在且内容相同」
    const second = importAgentHubData(store, fixture)
    expect(second.comments).toEqual({ inserted: 0, skipped: 2, conflicted: 0 })
    expect(second.conflicts).toEqual([])
    expect(second.renames).toEqual([])
    expect(store.counts().comments).toBe(2)
  })

  it("重复 id 且内容完全相同只落一条", () => {
    const dupId = "c-same"
    const comment = {
      id: dupId,
      role: "user" as const,
      body: "同一条消息",
      createdAt: "2026-07-25T00:00:02.000Z",
    }
    const fixture: AgentHubData = {
      topics: [
        {
          id: "topic-same",
          title: "重复 id 同内容",
          createdAt: "2026-07-25T00:00:00.000Z",
          threads: [
            {
              id: "thread-same",
              title: "线程",
              createdAt: "2026-07-25T00:00:01.000Z",
              // 位置不同、其余字段全等：属于同一条记录被写了两遍
              comments: [comment, { ...comment }],
            },
          ],
        },
      ],
    }

    const result = importAgentHubData(store, fixture)
    expect(result.comments).toEqual({ inserted: 1, skipped: 1, conflicted: 0 })
    expect(result.conflicts).toEqual([])
    expect(result.renames).toEqual([])
    expect(store.listComments("thread-same").map((item) => item.id)).toEqual([
      dupId,
    ])
  })

  it("已有数据不被静默覆盖或清空，冲突逐条回报", () => {
    importAgentHubData(store, makeFixture())

    const changed = structuredClone(makeFixture())
    changed.topics[1].title = "被改名的主题"
    changed.topics.push({
      id: "topic-c",
      title: "新增主题",
      createdAt: "2026-04-01T00:00:00.000Z",
      threads: [],
    })

    const result = importAgentHubData(store, changed)

    expect(result.topics).toEqual({ inserted: 1, skipped: 1, conflicted: 1 })
    expect(result.conflicts).toEqual([
      {
        kind: "topic",
        id: "topic-a",
        reason: "已存在同 id 但内容不同的记录，保留原有数据",
      },
    ])
    // 原有数据保持原样，只新增缺失的记录
    expect(store.findTopic("topic-a")?.title).toBe("第一个主题")
    expect(store.findTopic("topic-c")?.title).toBe("新增主题")
    expect(store.counts()).toEqual({ topics: 3, threads: 3, comments: 7 })
  })
})
