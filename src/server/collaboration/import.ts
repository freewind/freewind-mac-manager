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

/**
 * 同批输入内 id 重复、被确定性改名后真正写入的记录。
 *
 * 源数据里出现过把未展开的 shell 替换当成 id 的情况
 * （`tm-$(date +%s)` 在同一 Thread 里出现两次，正文不同），
 * 这类记录不能当冲突丢掉，也不能覆盖，只能改名后各自保留。
 */
export type ImportRename = {
  kind: ImportConflictKind
  originalId: string
  newId: string
}

export type ImportResult = {
  topics: ImportCounts
  threads: ImportCounts
  comments: ImportCounts
  conflicts: ImportConflict[]
  /**
   * 因同批内 id 重复而改名的记录明细；计数即 `renames.length`。
   * 只列本次真正写入的改名：重复导入全部跳过时为空，便于确认幂等。
   */
  renames: ImportRename[]
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

/**
 * 批内重复判定用的内容签名。
 *
 * position 由数组下标派生、只是存储细节，不参与内容比较；其余字段全等
 * 才算「同一条记录被写了两遍」，此时按既有幂等规则跳过。
 */
const contentSignature = (record: object): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(record).filter(([key]) => key !== "position")
    )
  )

type ResolvedId = {
  /** 本条记录实际使用的 id（可能是改名后的）。 */
  id: string
  /** 发生改名时给出明细，否则为 null。 */
  rename: ImportRename | null
  /** 与批内已出现过的记录内容完全相同，应跳过。 */
  duplicate: boolean
}

type BatchDedup = {
  resolve: <T extends { id: string }>(
    kind: ImportConflictKind,
    record: T
  ) => ResolvedId
}

/**
 * 同批输入内重复 id 的确定性去重：
 * - 第 1 次出现保持原 id；
 * - 第 N 次出现（N≥2）内容与已出现过的某次完全相同 → 视为同一条记录，跳过；
 * - 第 N 次出现（N≥2）内容不同 → 记为 `<原id>#dup<N>`，各自保留。
 *
 * 规则只看输入本身、与库内状态无关，所以可复现：重复导入会算出同样的 id，
 * 依然全部命中「已存在且内容相同」而跳过。
 */
const createBatchDedup = (): BatchDedup => {
  const occurrences = new Map<string, number>()
  const signatures = new Map<string, Set<string>>()
  return {
    resolve: (kind, record) => {
      const key = `${kind}:${record.id}`
      const seen = (occurrences.get(key) ?? 0) + 1
      occurrences.set(key, seen)
      const known = signatures.get(key) ?? new Set<string>()
      signatures.set(key, known)
      const signature = contentSignature(record)

      if (seen === 1) {
        known.add(signature)
        return { id: record.id, rename: null, duplicate: false }
      }
      if (known.has(signature)) {
        return { id: record.id, rename: null, duplicate: true }
      }
      known.add(signature)
      const newId = `${record.id}#dup${seen}`
      return {
        id: newId,
        rename: { kind, originalId: record.id, newId },
        duplicate: false,
      }
    },
  }
}

type ApplyOutcome = "inserted" | "skipped" | "conflicted"

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
): ApplyOutcome => {
  const { kind, next, existing, insert, counts, conflicts } = options
  if (!existing) {
    insert(next)
    counts.inserted += 1
    return "inserted"
  }
  if (
    isIdentical(
      existing as unknown as Record<string, unknown>,
      next as unknown as Record<string, unknown>
    )
  ) {
    counts.skipped += 1
    return "skipped"
  }
  counts.conflicted += 1
  conflicts.push({
    kind,
    id: next.id,
    reason: "已存在同 id 但内容不同的记录，保留原有数据",
  })
  return "conflicted"
}

type ApplyOneOptions<T extends { id: string }> = {
  kind: ImportConflictKind
  record: T
  find: (id: string) => T | null
  insert: (record: T) => void
  counts: ImportCounts
}

/**
 * 一条记录的完整落库路径：先做批内去重（必要时改名），再按 id 落库，
 * 最后把「真正写入的改名」记进结果，供人工核对。
 * 返回实际使用的 id，调用方据此修正子记录的归属 id。
 */
const applyOne = <T extends { id: string }>(
  result: ImportResult,
  dedup: BatchDedup,
  options: ApplyOneOptions<T>
): { id: string } => {
  const resolved = dedup.resolve(options.kind, options.record)
  if (resolved.duplicate) {
    options.counts.skipped += 1
    return { id: resolved.id }
  }
  const next = { ...options.record, id: resolved.id }
  const outcome = applyRecord({
    kind: options.kind,
    next,
    existing: options.find(resolved.id),
    insert: options.insert,
    counts: options.counts,
    conflicts: result.conflicts,
  })
  if (resolved.rename && outcome === "inserted") {
    result.renames.push(resolved.rename)
  }
  return { id: resolved.id }
}

/**
 * 从 freewind-agent-hub 的 data/db.json 形状导入协作数据。
 *
 * - 先做 schema 校验，非法输入直接拒绝，不产生任何写入；
 * - 整批在一个事务里导入，任一步失败整体回滚；
 * - 已存在的数据不会被覆盖或清空，冲突逐条回报；
 * - 同批内重复 id 按 `<原id>#dup<N>` 改名保留，正文一条不丢；
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
    renames: [],
  }
  const dedup = createBatchDedup()

  store.transaction(() => {
    parsed.data.topics.forEach((topic, topicIndex) => {
      const topicRef = applyOne(result, dedup, {
        kind: "topic",
        record: toTopicRecord(topic, topicIndex),
        find: (id) => store.findTopic(id),
        insert: (record) => store.insertTopic(record),
        counts: result.topics,
      })

      topic.threads.forEach((thread, threadIndex) => {
        const threadRef = applyOne(result, dedup, {
          kind: "thread",
          record: toThreadRecord(thread, topicRef.id, threadIndex),
          find: (id) => store.findThread(id),
          insert: (record) => store.insertThread(record),
          counts: result.threads,
        })

        thread.comments.forEach((comment, commentIndex) => {
          applyOne(result, dedup, {
            kind: "comment",
            record: toCommentRecord(comment, threadRef.id, commentIndex),
            find: (id) => store.findComment(id),
            insert: (record) => store.insertComment(record),
            counts: result.comments,
          })
        })
      })
    })
  })

  return result
}
