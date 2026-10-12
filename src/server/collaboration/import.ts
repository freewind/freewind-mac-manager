import {
  type AgentHubComment,
  AgentHubDataSchema,
  type AgentHubThread,
  type AgentHubTopic,
  type CollaborationComment,
  type CollaborationThreadRecord,
  type CollaborationTopicRecord,
} from "@shared/api-contract/schemas/collaboration"
import type { CollaborationStore } from "./store"

/** 导入计数：新增、跳过（已存在且内容相同）、冲突（已存在但内容不同）。 */
export type ImportCounts = {
  inserted: number
  skipped: number
  conflicted: number
}

export type ImportConflictKind = "topic" | "thread" | "comment"

export type ImportConflict = {
  kind: ImportConflictKind
  id: string
  reason: string
}

export type ImportResult = {
  topics: ImportCounts
  threads: ImportCounts
  comments: ImportCounts
  conflicts: ImportConflict[]
}

const emptyCounts = (): ImportCounts => ({
  inserted: 0,
  skipped: 0,
  conflicted: 0,
})

/**
 * 把源树形结构摊平成存储记录：可选字段统一落成 null，数组下标即显式 position。
 */
const toTopicRecord = (
  topic: AgentHubTopic,
  position: number
): CollaborationTopicRecord => ({
  id: topic.id,
  title: topic.title,
  createdAt: topic.createdAt,
  completedAt: topic.completedAt ?? null,
  createdByAgent: topic.createdByAgent ?? null,
  agentNotifyUrl: topic.agentNotifyUrl ?? null,
  agentNotifyEnabled: topic.agentNotifyEnabled ?? null,
  position,
})

const toThreadRecord = (
  thread: AgentHubThread,
  topicId: string,
  position: number
): CollaborationThreadRecord => ({
  id: thread.id,
  topicId,
  title: thread.title,
  createdAt: thread.createdAt,
  completedAt: thread.completedAt ?? null,
  createdByAgent: thread.createdByAgent ?? null,
  userLastReadCommentId: thread.userLastReadCommentId ?? null,
  position,
})

const toCommentRecord = (
  comment: AgentHubComment,
  threadId: string,
  position: number
): CollaborationComment => ({
  id: comment.id,
  threadId,
  role: comment.role,
  body: comment.body,
  createdAt: comment.createdAt,
  updatedAt: comment.updatedAt ?? null,
  readByAgent: comment.readByAgent ?? null,
  authorAgent: comment.authorAgent ?? null,
  position,
})

/** 逐字段比较存储记录（两边键集合相同，不含派生字段）。 */
const isIdentical = (
  existing: Record<string, unknown>,
  next: Record<string, unknown>
): boolean =>
  Object.keys(existing).length === Object.keys(next).length &&
  Object.entries(existing).every(([key, value]) => next[key] === value)

type ApplyOptions<T extends { id: string }> = {
  kind: ImportConflictKind
  next: T
  existing: T | null
  insert: (record: T) => void
  counts: ImportCounts
  conflicts: ImportConflict[]
}

/**
 * 按 id 落一条记录：
 * - 不存在 → 插入；
 * - 已存在且逐字段相同 → 跳过（重复导入幂等）；
 * - 已存在但内容不同 → 记为冲突，保留原有数据，绝不静默覆盖。
 */
const applyRecord = <T extends { id: string }>(
  options: ApplyOptions<T>
): void => {
  const { kind, next, existing, insert, counts, conflicts } = options
  if (!existing) {
    insert(next)
    counts.inserted += 1
    return
  }
  if (
    isIdentical(
      existing as unknown as Record<string, unknown>,
      next as unknown as Record<string, unknown>
    )
  ) {
    counts.skipped += 1
    return
  }
  counts.conflicted += 1
  conflicts.push({
    kind,
    id: next.id,
    reason: "已存在同 id 但内容不同的记录，保留原有数据",
  })
}

/**
 * 从 freewind-agent-hub 的 data/db.json 形状导入协作数据。
 *
 * - 先做 schema 校验，非法输入直接拒绝，不产生任何写入；
 * - 整批在一个事务里导入，任一步失败整体回滚；
 * - 已存在的数据不会被覆盖或清空，冲突逐条回报；
 * - 同一份数据重复导入不产生重复记录。
 */
export const importAgentHubData = (
  store: CollaborationStore,
  input: unknown
): ImportResult => {
  const parsed = AgentHubDataSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const location = first?.path.length ? first.path.join(".") : "根节点"
    throw new Error(
      `导入数据不符合 agent-hub 的 db.json 形状（${location}：${
        first?.message ?? "未知错误"
      }）`
    )
  }

  const result: ImportResult = {
    topics: emptyCounts(),
    threads: emptyCounts(),
    comments: emptyCounts(),
    conflicts: [],
  }

  store.transaction(() => {
    parsed.data.topics.forEach((topic, topicIndex) => {
      const topicRecord = toTopicRecord(topic, topicIndex)
      applyRecord({
        kind: "topic",
        next: topicRecord,
        existing: store.findTopic(topicRecord.id),
        insert: (record) => store.insertTopic(record),
        counts: result.topics,
        conflicts: result.conflicts,
      })

      topic.threads.forEach((thread, threadIndex) => {
        const threadRecord = toThreadRecord(thread, topic.id, threadIndex)
        applyRecord({
          kind: "thread",
          next: threadRecord,
          existing: store.findThread(threadRecord.id),
          insert: (record) => store.insertThread(record),
          counts: result.threads,
          conflicts: result.conflicts,
        })

        thread.comments.forEach((comment, commentIndex) => {
          const commentRecord = toCommentRecord(
            comment,
            thread.id,
            commentIndex
          )
          applyRecord({
            kind: "comment",
            next: commentRecord,
            existing: store.findComment(commentRecord.id),
            insert: (record) => store.insertComment(record),
            counts: result.comments,
            conflicts: result.conflicts,
          })
        })
      })
    })
  })

  return result
}
