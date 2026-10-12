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
    position INTEGER NOT NULL
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

  insertComment(record: CollaborationComment): void {
    this.db
      .prepare(
        `INSERT INTO collaboration_comment (
           id, thread_id, role, body, created_at, updated_at, read_by_agent,
           author_agent, position
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        record.position
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
