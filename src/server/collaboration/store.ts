import { mkdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { DATABASE_FILE } from "@server/env"
import type {
  CollaborationComment,
  CollaborationThread,
  CollaborationThreadRecord,
  CollaborationTopic,
  CollaborationTopicRecord,
} from "@shared/api-contract/schemas/collaboration"

/**
 * 协作数据存储：Topic / Thread / Comment 三张表，表名统一带 collaboration_ 前缀。
 *
 * 源项目（freewind-agent-hub）用数组顺序表达显示顺序，关系库必须落成显式
 * position 字段；派生值（未读数、threadCount、link）不落库，读取时现算。
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS collaboration_topic (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    created_by_agent TEXT,
    agent_notify_url TEXT,
    agent_notify_enabled INTEGER,
    position INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS collaboration_thread (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    created_by_agent TEXT,
    user_last_read_comment_id TEXT,
    position INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS collaboration_comment (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    role TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    read_by_agent INTEGER,
    author_agent TEXT,
    position INTEGER NOT NULL,
    request_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_collaboration_thread_topic
    ON collaboration_thread (topic_id, position, id);
  CREATE INDEX IF NOT EXISTS idx_collaboration_comment_thread
    ON collaboration_comment (thread_id, position, id);
`

type TopicRow = {
  id: string
  title: string
  created_at: string
  completed_at: string | null
  created_by_agent: string | null
  agent_notify_url: string | null
  agent_notify_enabled: number | null
  position: number
}

type ThreadRow = {
  id: string
  topic_id: string
  title: string
  created_at: string
  completed_at: string | null
  created_by_agent: string | null
  user_last_read_comment_id: string | null
  position: number
}

type CommentRow = {
  id: string
  thread_id: string
  role: string
  body: string
  created_at: string
  updated_at: string | null
  read_by_agent: number | null
  author_agent: string | null
  position: number
}

/** SQLite 没有布尔类型：null 表示源数据缺省，0/1 表示明确的 false/true。 */
const toBoolean = (value: number | null): boolean | null =>
  value === null ? null : value === 1

const fromBoolean = (value: boolean | null): number | null =>
  value === null ? null : value ? 1 : 0

const toTopicRecord = (row: TopicRow): CollaborationTopicRecord => ({
  id: row.id,
  title: row.title,
  createdAt: row.created_at,
  completedAt: row.completed_at,
  createdByAgent: row.created_by_agent,
  agentNotifyUrl: row.agent_notify_url,
  agentNotifyEnabled: toBoolean(row.agent_notify_enabled),
  position: row.position,
})

const toThreadRecord = (row: ThreadRow): CollaborationThreadRecord => ({
  id: row.id,
  topicId: row.topic_id,
  title: row.title,
  createdAt: row.created_at,
  completedAt: row.completed_at,
  createdByAgent: row.created_by_agent,
  userLastReadCommentId: row.user_last_read_comment_id,
  position: row.position,
})

const toComment = (row: CommentRow): CollaborationComment => ({
  id: row.id,
  threadId: row.thread_id,
  role: row.role === "agent" ? "agent" : "user",
  body: row.body,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  readByAgent: toBoolean(row.read_by_agent),
  authorAgent: row.author_agent,
  position: row.position,
})

/**
 * 派生未读数，规则与源项目一致：
 * - 已读位置为 null（从未读过）→ 全部 agent 评论都算未读；
 * - 已读位置有效 → 它之后 role 为 agent 的评论数；
 * - 已读位置失效（指向已不存在的评论）→ 视为已读，返回 0。
 */
export const computeUserUnreadCount = (
  comments: CollaborationComment[],
  marker: string | null
): number => {
  if (marker === null) {
    return comments.filter((comment) => comment.role === "agent").length
  }
  const index = comments.findIndex((comment) => comment.id === marker)
  if (index < 0) return 0
  return comments.slice(index + 1).filter((comment) => comment.role === "agent")
    .length
}

/** 页内 Thread 跳转 Markdown，与源项目 formatThreadLink 保持一致。 */
export const formatThreadLink = (title: string, threadId: string): string =>
  `[${title}](#thread:${threadId})`

/**
 * 把目标顺序落到实际存在的 id 上：先按给定顺序，未列出的保持原相对顺序。
 * 与源项目 reorder 的语义一致（列出的在前，其余补在后面）。
 */
const orderIds = (current: string[], orderedIds: string[]): string[] => {
  const known = new Set(current)
  const seen = new Set<string>()
  const next: string[] = []
  for (const id of orderedIds) {
    if (!known.has(id) || seen.has(id)) continue
    seen.add(id)
    next.push(id)
  }
  for (const id of current) {
    if (!seen.has(id)) next.push(id)
  }
  return next
}

/**
 * 协作存储。默认使用项目统一数据库（env.DATABASE_FILE）；
 * CLI 与测试可以显式传入别的库文件，但不能自行拼业务库路径。
 */
export class CollaborationStore {
  private readonly db: DatabaseSync

  constructor(file: string = DATABASE_FILE) {
    mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file, { timeout: 5000 })
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA synchronous = NORMAL")
    this.db.exec(SCHEMA)
    this.ensureRequestIdColumn()
  }

  /**
   * 幂等列迁移：早期版本的表没有 request_id。老库补列而不是重建，
   * 已有记录保持不动；唯一索引只对非空值生效，历史数据不受影响。
   */
  private ensureRequestIdColumn(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(collaboration_comment)")
      .all() as { name: string }[]
    if (!columns.some((column) => column.name === "request_id")) {
      this.db.exec(
        "ALTER TABLE collaboration_comment ADD COLUMN request_id TEXT"
      )
    }
    this.db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_collaboration_comment_request
       ON collaboration_comment (request_id) WHERE request_id IS NOT NULL`
    )
  }

  /** 整批导入用的事务：任一步失败整体回滚，不留下半批数据。 */
  transaction<T>(run: () => T): T {
    this.db.exec("BEGIN IMMEDIATE")
    try {
      const result = run()
      this.db.exec("COMMIT")
      return result
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
  }

  insertTopic(record: CollaborationTopicRecord): void {
    this.db
      .prepare(
        `INSERT INTO collaboration_topic (
           id, title, created_at, completed_at, created_by_agent,
           agent_notify_url, agent_notify_enabled, position
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.title,
        record.createdAt,
        record.completedAt,
        record.createdByAgent,
        record.agentNotifyUrl,
        fromBoolean(record.agentNotifyEnabled),
        record.position
      )
  }

  insertThread(record: CollaborationThreadRecord): void {
    this.db
      .prepare(
        `INSERT INTO collaboration_thread (
           id, topic_id, title, created_at, completed_at, created_by_agent,
           user_last_read_comment_id, position
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.topicId,
        record.title,
        record.createdAt,
        record.completedAt,
        record.createdByAgent,
        record.userLastReadCommentId,
        record.position
      )
  }

  insertComment(
    record: CollaborationComment,
    requestId: string | null = null
  ): void {
    this.db
      .prepare(
        `INSERT INTO collaboration_comment (
           id, thread_id, role, body, created_at, updated_at, read_by_agent,
           author_agent, position, request_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.threadId,
        record.role,
        record.body,
        record.createdAt,
        record.updatedAt,
        fromBoolean(record.readByAgent),
        record.authorAgent,
        record.position,
        requestId
      )
  }

  findTopic(id: string): CollaborationTopicRecord | null {
    const row = this.db
      .prepare("SELECT * FROM collaboration_topic WHERE id = ?")
      .get(id) as TopicRow | undefined
    return row ? toTopicRecord(row) : null
  }

  findThread(id: string): CollaborationThreadRecord | null {
    const row = this.db
      .prepare("SELECT * FROM collaboration_thread WHERE id = ?")
      .get(id) as ThreadRow | undefined
    return row ? toThreadRecord(row) : null
  }

  findComment(id: string): CollaborationComment | null {
    const row = this.db
      .prepare("SELECT * FROM collaboration_comment WHERE id = ?")
      .get(id) as CommentRow | undefined
    return row ? toComment(row) : null
  }

  listComments(threadId: string): CollaborationComment[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM collaboration_comment
         WHERE thread_id = ? ORDER BY position, id`
      )
      .all(threadId) as CommentRow[]
    return rows.map(toComment)
  }

  /** 线程读取形：记录 + 现算未读数与跳转链接。 */
  listThreads(topicId: string): CollaborationThread[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM collaboration_thread
         WHERE topic_id = ? ORDER BY position, id`
      )
      .all(topicId) as ThreadRow[]
    return rows.map((row) => {
      const record = toThreadRecord(row)
      const comments = this.listComments(record.id)
      return {
        ...record,
        userUnreadCount: computeUserUnreadCount(
          comments,
          record.userLastReadCommentId
        ),
        link: formatThreadLink(record.title, record.id),
      }
    })
  }

  /** 主题读取形：记录 + 现算线程数与未读合计。 */
  listTopics(): CollaborationTopic[] {
    const rows = this.db
      .prepare("SELECT * FROM collaboration_topic ORDER BY position, id")
      .all() as TopicRow[]
    return rows.map((row) => {
      const record = toTopicRecord(row)
      const threads = this.listThreads(record.id)
      return {
        ...record,
        threadCount: threads.length,
        userUnreadCount: threads.reduce(
          (total, thread) => total + thread.userUnreadCount,
          0
        ),
      }
    })
  }

  /** 单个 Topic 读取形：记录 + 派生字段；不存在返回 null。 */
  getTopic(id: string): CollaborationTopic | null {
    const record = this.findTopic(id)
    if (!record) return null
    const threads = this.listThreads(id)
    return {
      ...record,
      threadCount: threads.length,
      userUnreadCount: threads.reduce(
        (total, thread) => total + thread.userUnreadCount,
        0
      ),
    }
  }

  /** 单个 Thread 读取形；必须同时匹配 topicId，跨 Topic 的 id 一律当作不存在。 */
  getThread(topicId: string, id: string): CollaborationThread | null {
    return this.listThreads(topicId).find((thread) => thread.id === id) ?? null
  }

  /**
   * 新建 Topic：源项目把新 Topic 放在最前（数组 unshift），
   * 这里用「既有 position 整体 +1、新记录占 0」保持同样的显示顺序。
   */
  createTopic(input: {
    id: string
    title: string
    createdByAgent: string | null
    createdAt: string
  }): CollaborationTopicRecord {
    return this.transaction(() => {
      this.db.exec("UPDATE collaboration_topic SET position = position + 1")
      this.insertTopic({
        id: input.id,
        title: input.title,
        createdAt: input.createdAt,
        completedAt: null,
        createdByAgent: input.createdByAgent,
        agentNotifyUrl: null,
        agentNotifyEnabled: null,
        position: 0,
      })
      const created = this.findTopic(input.id)
      if (!created) throw new Error("Topic 创建后无法读回")
      return created
    })
  }

  updateTopicTitle(id: string, title: string): CollaborationTopicRecord | null {
    const result = this.db
      .prepare("UPDATE collaboration_topic SET title = ? WHERE id = ?")
      .run(title, id)
    if (Number(result.changes ?? 0) === 0) return null
    return this.findTopic(id)
  }

  setTopicCompleted(
    id: string,
    completedAt: string | null
  ): CollaborationTopicRecord | null {
    const result = this.db
      .prepare("UPDATE collaboration_topic SET completed_at = ? WHERE id = ?")
      .run(completedAt, id)
    if (Number(result.changes ?? 0) === 0) return null
    return this.findTopic(id)
  }

  /** 删除 Topic 连同它的 Thread 与 Comment：源项目删除子树是同一个动作。 */
  deleteTopic(id: string): boolean {
    return this.transaction(() => {
      if (this.findTopic(id) === null) return false
      this.db
        .prepare(
          `DELETE FROM collaboration_comment WHERE thread_id IN (
             SELECT id FROM collaboration_thread WHERE topic_id = ?
           )`
        )
        .run(id)
      this.db
        .prepare("DELETE FROM collaboration_thread WHERE topic_id = ?")
        .run(id)
      this.db.prepare("DELETE FROM collaboration_topic WHERE id = ?").run(id)
      return true
    })
  }

  /** 按给定顺序重排 Topic；未列出的按原相对顺序排在后面。 */
  reorderTopics(orderedIds: string[]): void {
    this.transaction(() => {
      const current = (
        this.db
          .prepare("SELECT id FROM collaboration_topic ORDER BY position, id")
          .all() as { id: string }[]
      ).map((row) => row.id)
      const next = orderIds(current, orderedIds)
      const statement = this.db.prepare(
        "UPDATE collaboration_topic SET position = ? WHERE id = ?"
      )
      next.forEach((id, index) => {
        statement.run(index, id)
      })
    })
  }

  createThread(input: {
    id: string
    topicId: string
    title: string
    createdByAgent: string | null
    createdAt: string
  }): CollaborationThreadRecord {
    return this.transaction(() => {
      this.db
        .prepare(
          `UPDATE collaboration_thread SET position = position + 1
           WHERE topic_id = ?`
        )
        .run(input.topicId)
      this.insertThread({
        id: input.id,
        topicId: input.topicId,
        title: input.title,
        createdAt: input.createdAt,
        completedAt: null,
        createdByAgent: input.createdByAgent,
        userLastReadCommentId: null,
        position: 0,
      })
      const created = this.findThread(input.id)
      if (!created) throw new Error("Thread 创建后无法读回")
      return created
    })
  }

  updateThreadTitle(
    topicId: string,
    id: string,
    title: string
  ): CollaborationThreadRecord | null {
    const result = this.db
      .prepare(
        "UPDATE collaboration_thread SET title = ? WHERE id = ? AND topic_id = ?"
      )
      .run(title, id, topicId)
    if (Number(result.changes ?? 0) === 0) return null
    return this.findThread(id)
  }

  setThreadCompleted(
    topicId: string,
    id: string,
    completedAt: string | null
  ): CollaborationThreadRecord | null {
    const result = this.db
      .prepare(
        `UPDATE collaboration_thread SET completed_at = ?
         WHERE id = ? AND topic_id = ?`
      )
      .run(completedAt, id, topicId)
    if (Number(result.changes ?? 0) === 0) return null
    return this.findThread(id)
  }

  /** 设置已读位置（上次读到的最后一条 comment id；null = 从未读过）。 */
  setThreadReadPosition(
    topicId: string,
    id: string,
    commentId: string | null
  ): CollaborationThreadRecord | null {
    const result = this.db
      .prepare(
        `UPDATE collaboration_thread SET user_last_read_comment_id = ?
         WHERE id = ? AND topic_id = ?`
      )
      .run(commentId, id, topicId)
    if (Number(result.changes ?? 0) === 0) return null
    return this.findThread(id)
  }

  /** 删除 Thread 连同它的 Comment。 */
  deleteThread(topicId: string, id: string): boolean {
    return this.transaction(() => {
      const thread = this.findThread(id)
      if (!thread || thread.topicId !== topicId) return false
      this.db
        .prepare("DELETE FROM collaboration_comment WHERE thread_id = ?")
        .run(id)
      this.db
        .prepare(
          "DELETE FROM collaboration_thread WHERE id = ? AND topic_id = ?"
        )
        .run(id, topicId)
      return true
    })
  }

  reorderThreads(topicId: string, orderedIds: string[]): void {
    this.transaction(() => {
      const current = (
        this.db
          .prepare(
            `SELECT id FROM collaboration_thread WHERE topic_id = ?
             ORDER BY position, id`
          )
          .all(topicId) as { id: string }[]
      ).map((row) => row.id)
      const next = orderIds(current, orderedIds)
      const statement = this.db.prepare(
        "UPDATE collaboration_thread SET position = ? WHERE id = ?"
      )
      next.forEach((id, index) => {
        statement.run(index, id)
      })
    })
  }

  /**
   * 追加一条消息（排在最后，与源项目一致）。requestId 非空时写入幂等列：
   * 同一请求标识重复提交会被唯一索引拦下，调用方据 findCommentByRequestId 复用结果。
   */
  appendComment(
    input: {
      id: string
      threadId: string
      role: "user" | "agent"
      body: string
      createdAt: string
      authorAgent: string | null
      readByAgent: boolean | null
    },
    requestId: string | null
  ): CollaborationComment {
    return this.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT COALESCE(MAX(position), -1) AS max FROM collaboration_comment
           WHERE thread_id = ?`
        )
        .get(input.threadId) as { max: number }
      this.insertComment(
        {
          id: input.id,
          threadId: input.threadId,
          role: input.role,
          body: input.body,
          createdAt: input.createdAt,
          updatedAt: null,
          readByAgent: input.readByAgent,
          authorAgent: input.authorAgent,
          position: Number(row.max) + 1,
        },
        requestId
      )
      const created = this.findComment(input.id)
      if (!created) throw new Error("消息保存后无法读回")
      return created
    })
  }

  findCommentByRequestId(requestId: string): CollaborationComment | null {
    const row = this.db
      .prepare("SELECT * FROM collaboration_comment WHERE request_id = ?")
      .get(requestId) as CommentRow | undefined
    return row ? toComment(row) : null
  }

  updateCommentBody(
    threadId: string,
    id: string,
    input: { body: string; updatedAt: string; readByAgent: boolean | null }
  ): CollaborationComment | null {
    const result = this.db
      .prepare(
        `UPDATE collaboration_comment
         SET body = ?, updated_at = ?, read_by_agent = ?
         WHERE id = ? AND thread_id = ?`
      )
      .run(
        input.body,
        input.updatedAt,
        fromBoolean(input.readByAgent),
        id,
        threadId
      )
    if (Number(result.changes ?? 0) === 0) return null
    return this.findComment(id)
  }

  deleteComment(threadId: string, id: string): boolean {
    const result = this.db
      .prepare(
        "DELETE FROM collaboration_comment WHERE id = ? AND thread_id = ?"
      )
      .run(id, threadId)
    return Number(result.changes ?? 0) > 0
  }

  /**
   * 关键词搜索：标题与正文做大小写不敏感的子串匹配。
   * 命中 Comment 额外补 topicId，供前端定位到所属 Topic。
   */
  search(query: string): {
    topics: CollaborationTopic[]
    threads: CollaborationThread[]
    comments: (CollaborationComment & { topicId: string })[]
  } {
    const pattern = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
    const topicRows = this.db
      .prepare(
        `SELECT * FROM collaboration_topic WHERE title LIKE ? ESCAPE '\\'
         ORDER BY position, id`
      )
      .all(pattern) as TopicRow[]
    const threadRows = this.db
      .prepare(
        `SELECT * FROM collaboration_thread WHERE title LIKE ? ESCAPE '\\'
         ORDER BY topic_id, position, id`
      )
      .all(pattern) as ThreadRow[]
    const commentRows = this.db
      .prepare(
        `SELECT * FROM collaboration_comment WHERE body LIKE ? ESCAPE '\\'
         ORDER BY thread_id, position, id`
      )
      .all(pattern) as CommentRow[]

    const topics = topicRows
      .map((row) => this.getTopic(row.id))
      .filter((topic): topic is CollaborationTopic => topic !== null)
    const threads = threadRows
      .map((row) => this.getThread(row.topic_id, row.id))
      .filter((thread): thread is CollaborationThread => thread !== null)
    const comments: (CollaborationComment & { topicId: string })[] = []
    for (const row of commentRows) {
      const comment = toComment(row)
      const thread = this.findThread(comment.threadId)
      if (thread) comments.push({ ...comment, topicId: thread.topicId })
    }
    return { topics, threads, comments }
  }

  counts(): { topics: number; threads: number; comments: number } {
    const count = (table: string): number =>
      Number(
        (
          this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
            count: number
          }
        ).count
      )
    return {
      topics: count("collaboration_topic"),
      threads: count("collaboration_thread"),
      comments: count("collaboration_comment"),
    }
  }

  close(): void {
    this.db.close()
  }
}
