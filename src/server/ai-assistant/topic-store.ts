import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { PublicOperationError } from "@server/common/public-error"
import { DATABASE_FILE } from "@server/env"
import {
  AI_TOPIC_BODY_MAX,
  AI_TOPIC_TITLE_MAX,
  type AiTopic,
  type AiTopicMessage,
  type AiTopicStatus,
  type AiTopicThread,
} from "@shared/api-contract"

/**
 * AI 话题存储：话题、线程、消息三张表，表名统一带 ai_topic_ 前缀。
 *
 * 一个话题对应一个 Agent 对话：Pi 的会话条目（JSONL）也按话题保存，
 * 重启后据此恢复完整上下文。线程不持有会话，只是消息的组织方式。
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ai_topic (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    settings_snapshot TEXT NOT NULL DEFAULT '{}',
    entries TEXT NOT NULL DEFAULT '',
    request_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ai_topic_thread (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL,
    title TEXT NOT NULL,
    archived_at INTEGER,
    created_by TEXT NOT NULL,
    last_read_seq INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ai_topic_message (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    role TEXT NOT NULL,
    body TEXT NOT NULL,
    seq INTEGER NOT NULL,
    request_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ai_topic_thread_topic
    ON ai_topic_thread (topic_id, position, id);
  CREATE INDEX IF NOT EXISTS idx_ai_topic_message_thread
    ON ai_topic_message (thread_id, seq);
  CREATE INDEX IF NOT EXISTS idx_ai_topic_message_topic
    ON ai_topic_message (topic_id, seq);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_topic_message_request
    ON ai_topic_message (request_id) WHERE request_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_topic_request
    ON ai_topic (request_id) WHERE request_id IS NOT NULL;
`

/** 单个话题的线程上限：防止模型无限建线程把界面和查询拖垮。 */
export const AI_TOPIC_THREAD_LIMIT = 300
/** 单条消息读取上限：一次最多返回这么多条，避免整段历史一次拉回。 */
export const AI_TOPIC_MESSAGE_LIMIT = 500
/**
 * 会话条目（JSONL）上限。超过它就不能再可靠保存上下文，
 * 必须明确报错，不能让用户以为历史还在。
 */
export const AI_TOPIC_ENTRIES_MAX_BYTES = 16 * 1024 * 1024

let database: DatabaseSync | null = null

const db = (): DatabaseSync => {
  if (database) return database
  mkdirSync(path.dirname(DATABASE_FILE), { recursive: true })
  const opened = new DatabaseSync(DATABASE_FILE, { timeout: 5000 })
  opened.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;${SCHEMA}`)
  database = opened
  // 上次进程留下的 running 都是中断，一律按结果未知收尾。
  opened
    .prepare(
      "UPDATE ai_topic SET status='unknown', updated_at=? WHERE status='running'"
    )
    .run(Date.now())
  return database
}

type TopicRow = {
  id: string
  title: string
  status: string
  settings_snapshot: string
  entries: string
  created_at: number
  updated_at: number
}

type ThreadRow = {
  id: string
  topic_id: string
  title: string
  archived_at: number | null
  created_by: string
  last_read_seq: number
  position: number
  created_at: number
  updated_at: number
  message_count: number
  unread_count: number
}

type MessageRow = {
  id: string
  thread_id: string
  role: string
  body: string
  seq: number
  created_at: number
}

const isStatus = (value: string): value is AiTopicStatus =>
  value === "idle" ||
  value === "running" ||
  value === "done" ||
  value === "unknown"

const toThread = (row: ThreadRow): AiTopicThread => ({
  id: row.id,
  topicId: row.topic_id,
  title: row.title,
  archivedAt: row.archived_at,
  createdBy: row.created_by === "agent" ? "agent" : "user",
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  messageCount: row.message_count,
  unreadCount: row.unread_count,
})

const toMessage = (row: MessageRow): AiTopicMessage => ({
  id: row.id,
  threadId: row.thread_id,
  role: row.role === "agent" ? "agent" : "user",
  body: row.body,
  seq: row.seq,
  createdAt: row.created_at,
})

/**
 * 线程读取视图：消息数与未读数都现算。
 * 未读只看 role=agent 且 seq 大于已读位置的消息——用户自己发的不算未读。
 */
const THREAD_SELECT = `
  SELECT t.*,
    (SELECT COUNT(*) FROM ai_topic_message m WHERE m.thread_id = t.id)
      AS message_count,
    (SELECT COUNT(*) FROM ai_topic_message m
       WHERE m.thread_id = t.id AND m.seq > t.last_read_seq AND m.role = 'agent')
      AS unread_count
  FROM ai_topic_thread t
`

const topicUnread = (topicId: string): number => {
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS count FROM ai_topic_message m
       JOIN ai_topic_thread t ON t.id = m.thread_id
       WHERE m.topic_id = ? AND m.role = 'agent' AND m.seq > t.last_read_seq`
    )
    .get(topicId) as { count: number } | undefined
  return row?.count ?? 0
}

const toTopic = (row: TopicRow): AiTopic => {
  if (!isStatus(row.status))
    throw new PublicOperationError(500, "话题记录状态非法")
  const threads = db()
    .prepare(
      "SELECT COUNT(*) AS count FROM ai_topic_thread WHERE topic_id = ? AND archived_at IS NULL"
    )
    .get(row.id) as { count: number } | undefined
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    threadCount: threads?.count ?? 0,
    unreadCount: topicUnread(row.id),
  }
}

const readTopicRow = (topicId: string): TopicRow => {
  const row = db()
    .prepare("SELECT * FROM ai_topic WHERE id = ?")
    .get(topicId) as TopicRow | undefined
  if (!row) throw new PublicOperationError(404, "话题不存在")
  return row
}

export const listTopics = (): AiTopic[] =>
  (
    db()
      .prepare("SELECT * FROM ai_topic ORDER BY updated_at DESC LIMIT 100")
      .all() as TopicRow[]
  ).map(toTopic)

export const getTopic = (topicId: string): AiTopic =>
  toTopic(readTopicRow(topicId))

export const listThreads = (topicId: string): AiTopicThread[] => {
  // 先确认话题存在，避免把「话题不存在」误报成「没有线程」。
  readTopicRow(topicId)
  return (
    db()
      .prepare(
        `${THREAD_SELECT} WHERE t.topic_id = ? ORDER BY t.position, t.id`
      )
      .all(topicId) as ThreadRow[]
  ).map(toThread)
}

export const getThread = (topicId: string, threadId: string): AiTopicThread => {
  const row = db()
    .prepare(`${THREAD_SELECT} WHERE t.topic_id = ? AND t.id = ?`)
    .get(topicId, threadId) as ThreadRow | undefined
  if (!row) throw new PublicOperationError(404, "线程不存在")
  return toThread(row)
}

const insertThread = (input: {
  topicId: string
  title: string
  createdBy: "user" | "agent"
  now: number
}): string => {
  const count = db()
    .prepare("SELECT COUNT(*) AS count FROM ai_topic_thread WHERE topic_id = ?")
    .get(input.topicId) as { count: number } | undefined
  if ((count?.count ?? 0) >= AI_TOPIC_THREAD_LIMIT) {
    throw new PublicOperationError(
      409,
      `话题线程数已达上限（${AI_TOPIC_THREAD_LIMIT}），请归档或删除一些线程`
    )
  }
  const position = db()
    .prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM ai_topic_thread WHERE topic_id = ?"
    )
    .get(input.topicId) as { next: number } | undefined
  const id = randomUUID()
  db()
    .prepare(
      `INSERT INTO ai_topic_thread(
         id, topic_id, title, archived_at, created_by, last_read_seq,
         position, created_at, updated_at
       ) VALUES (?, ?, ?, NULL, ?, 0, ?, ?, ?)`
    )
    .run(
      id,
      input.topicId,
      input.title,
      input.createdBy,
      position?.next ?? 0,
      input.now,
      input.now
    )
  return id
}

const DEFAULT_THREAD_TITLE = "默认线程"

/** 创建话题时就建默认线程：用户打开后能直接开口，不用先想办法建线程。 */
export const createTopic = (title: string): AiTopic => {
  const trimmed = title.trim()
  if (!trimmed) throw new PublicOperationError(400, "话题标题不能为空")
  if (trimmed.length > AI_TOPIC_TITLE_MAX)
    throw new PublicOperationError(400, "话题标题过长")
  const now = Date.now()
  const id = randomUUID()
  db().exec("BEGIN")
  try {
    db()
      .prepare(
        `INSERT INTO ai_topic(id, title, status, settings_snapshot, entries, created_at, updated_at)
         VALUES (?, ?, 'idle', '{}', '', ?, ?)`
      )
      .run(id, trimmed, now, now)
    insertThread({
      topicId: id,
      title: DEFAULT_THREAD_TITLE,
      createdBy: "user",
      now,
    })
    db().exec("COMMIT")
  } catch (error) {
    db().exec("ROLLBACK")
    throw error
  }
  return getTopic(id)
}

export const renameTopic = (topicId: string, title: string): AiTopic => {
  const trimmed = title.trim()
  if (!trimmed) throw new PublicOperationError(400, "话题标题不能为空")
  if (trimmed.length > AI_TOPIC_TITLE_MAX)
    throw new PublicOperationError(400, "话题标题过长")
  readTopicRow(topicId)
  db()
    .prepare("UPDATE ai_topic SET title = ?, updated_at = ? WHERE id = ?")
    .run(trimmed, Date.now(), topicId)
  return getTopic(topicId)
}

/** 删除话题：连同线程与消息一起删；正在执行的话题必须先停止。 */
export const deleteTopic = (topicId: string): void => {
  const row = readTopicRow(topicId)
  if (row.status === "running") {
    throw new PublicOperationError(409, "话题正在执行，请先停止再删除")
  }
  db().exec("BEGIN")
  try {
    db().prepare("DELETE FROM ai_topic_message WHERE topic_id = ?").run(topicId)
    db().prepare("DELETE FROM ai_topic_thread WHERE topic_id = ?").run(topicId)
    db().prepare("DELETE FROM ai_topic WHERE id = ?").run(topicId)
    db().exec("COMMIT")
  } catch (error) {
    db().exec("ROLLBACK")
    throw error
  }
}

export const createThread = (
  topicId: string,
  title: string,
  createdBy: "user" | "agent" = "user"
): AiTopicThread => {
  readTopicRow(topicId)
  const trimmed = title.trim()
  if (!trimmed) throw new PublicOperationError(400, "线程标题不能为空")
  if (trimmed.length > AI_TOPIC_TITLE_MAX)
    throw new PublicOperationError(400, "线程标题过长")
  const id = insertThread({
    topicId,
    title: trimmed,
    createdBy,
    now: Date.now(),
  })
  return getThread(topicId, id)
}

export const updateThread = (
  topicId: string,
  threadId: string,
  patch: { title?: string; archived?: boolean; read?: boolean }
): AiTopicThread => {
  getThread(topicId, threadId)
  const sets: string[] = []
  const values: (string | number | null)[] = []
  const now = Date.now()
  if (patch.title !== undefined) {
    const trimmed = patch.title.trim()
    if (!trimmed) throw new PublicOperationError(400, "线程标题不能为空")
    if (trimmed.length > AI_TOPIC_TITLE_MAX)
      throw new PublicOperationError(400, "线程标题过长")
    sets.push("title = ?")
    values.push(trimmed)
  }
  if (patch.archived !== undefined) {
    sets.push("archived_at = ?")
    values.push(patch.archived ? now : null)
    // 归档后不再接收新消息，残留未读没有意义；恢复归档也不该立刻显示旧未读。
    if (patch.archived) {
      sets.push(
        "last_read_seq = (SELECT COALESCE(MAX(seq), 0) FROM ai_topic_message WHERE thread_id = ?)"
      )
      values.push(threadId)
    }
  }
  if (patch.read) {
    sets.push(
      "last_read_seq = (SELECT COALESCE(MAX(seq), 0) FROM ai_topic_message WHERE thread_id = ?)"
    )
    values.push(threadId)
  }
  if (sets.length === 0)
    throw new PublicOperationError(400, "没有需要修改的字段")
  sets.push("updated_at = ?")
  values.push(now)
  db()
    .prepare(
      `UPDATE ai_topic_thread SET ${sets.join(", ")} WHERE id = ? AND topic_id = ?`
    )
    .run(...values, threadId, topicId)
  return getThread(topicId, threadId)
}

/**
 * 删除线程：最后一个未归档线程不能删，否则话题里没有地方可以继续提问。
 * 话题本身的删除由 deleteTopic 负责。
 */
export const deleteThread = (topicId: string, threadId: string): void => {
  const thread = getThread(topicId, threadId)
  if (thread.archivedAt === null) {
    const active = db()
      .prepare(
        "SELECT COUNT(*) AS count FROM ai_topic_thread WHERE topic_id = ? AND archived_at IS NULL"
      )
      .get(topicId) as { count: number } | undefined
    if ((active?.count ?? 0) <= 1) {
      throw new PublicOperationError(
        409,
        "这是话题里最后一个可用线程，不能删除；可以新建线程后再删"
      )
    }
  }
  db().exec("BEGIN")
  try {
    db()
      .prepare(
        "DELETE FROM ai_topic_message WHERE topic_id = ? AND thread_id = ?"
      )
      .run(topicId, threadId)
    db()
      .prepare("DELETE FROM ai_topic_thread WHERE id = ? AND topic_id = ?")
      .run(threadId, topicId)
    db().exec("COMMIT")
  } catch (error) {
    db().exec("ROLLBACK")
    throw error
  }
}

export const listMessages = (
  topicId: string,
  threadId: string,
  limit = AI_TOPIC_MESSAGE_LIMIT
): AiTopicMessage[] => {
  getThread(topicId, threadId)
  // 先按倒序取最近 limit 条，再翻回正序显示。
  const rows = db()
    .prepare(
      `SELECT * FROM ai_topic_message
       WHERE topic_id = ? AND thread_id = ?
       ORDER BY seq DESC LIMIT ?`
    )
    .all(
      topicId,
      threadId,
      Math.min(limit, AI_TOPIC_MESSAGE_LIMIT)
    ) as MessageRow[]
  return rows.reverse().map(toMessage)
}

/** 追加一条消息；seq 在事务里按话题分配，保证话题内严格递增。 */
export const appendMessage = (input: {
  topicId: string
  threadId: string
  role: "user" | "agent"
  body: string
  requestId?: string | null
}): AiTopicMessage => {
  const body = input.body
  if (!body.trim()) throw new PublicOperationError(400, "消息内容不能为空")
  if (body.length > AI_TOPIC_BODY_MAX)
    throw new PublicOperationError(400, "消息内容过长")
  getThread(input.topicId, input.threadId)
  const now = Date.now()
  db().exec("BEGIN")
  try {
    if (input.requestId) {
      const existing = db()
        .prepare("SELECT * FROM ai_topic_message WHERE request_id = ?")
        .get(input.requestId) as MessageRow | undefined
      if (existing) {
        db().exec("COMMIT")
        return toMessage(existing)
      }
    }
    const next = db()
      .prepare(
        "SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM ai_topic_message WHERE topic_id = ?"
      )
      .get(input.topicId) as { next: number } | undefined
    const id = randomUUID()
    db()
      .prepare(
        `INSERT INTO ai_topic_message(
           id, topic_id, thread_id, role, body, seq, request_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.topicId,
        input.threadId,
        input.role,
        body,
        next?.next ?? 1,
        input.requestId ?? null,
        now
      )
    db()
      .prepare("UPDATE ai_topic_thread SET updated_at = ? WHERE id = ?")
      .run(now, input.threadId)
    db()
      .prepare("UPDATE ai_topic SET updated_at = ? WHERE id = ?")
      .run(now, input.topicId)
    db().exec("COMMIT")
    const row = db()
      .prepare("SELECT * FROM ai_topic_message WHERE id = ?")
      .get(id) as MessageRow
    return toMessage(row)
  } catch (error) {
    db().exec("ROLLBACK")
    throw error
  }
}

export const setTopicStatus = (
  topicId: string,
  status: AiTopicStatus
): void => {
  db()
    .prepare("UPDATE ai_topic SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, Date.now(), topicId)
}

/** 执行前落库用户指令与请求标识：同一标识不会产生第二条用户消息。 */
export const startTopicRun = (
  topicId: string,
  status: AiTopicStatus,
  requestId: string | null
): void => {
  readTopicRow(topicId)
  db()
    .prepare(
      "UPDATE ai_topic SET status = ?, request_id = ?, updated_at = ? WHERE id = ?"
    )
    .run(status, requestId, Date.now(), topicId)
}

export const finishTopicRun = (
  topicId: string,
  status: AiTopicStatus
): void => {
  db()
    .prepare(
      "UPDATE ai_topic SET status = ?, request_id = NULL, updated_at = ? WHERE id = ? AND status = 'running'"
    )
    .run(status, Date.now(), topicId)
}

/** 按请求标识判断是否已经提交过：服务重启后也不能重跑同一个请求。 */
export const findTopicByRequestId = (
  requestId: string
): { id: string } | null => {
  const row = db()
    .prepare("SELECT id FROM ai_topic WHERE request_id = ?")
    .get(requestId) as { id: string } | undefined
  return row ?? null
}

export const readTopicEntries = (topicId: string): string =>
  readTopicRow(topicId).entries

/** 保存会话条目；超过上限直接报错，不写入半份历史。 */
export const saveTopicEntries = (topicId: string, entries: string): void => {
  if (Buffer.byteLength(entries, "utf8") > AI_TOPIC_ENTRIES_MAX_BYTES) {
    throw new PublicOperationError(
      409,
      "话题历史过大，无法继续保存上下文；请新建话题继续"
    )
  }
  db()
    .prepare("UPDATE ai_topic SET entries = ?, updated_at = ? WHERE id = ?")
    .run(entries, Date.now(), topicId)
}

export const saveTopicSettingsSnapshot = (
  topicId: string,
  snapshot: unknown
): void => {
  db()
    .prepare("UPDATE ai_topic SET settings_snapshot = ? WHERE id = ?")
    .run(JSON.stringify(snapshot), topicId)
}
