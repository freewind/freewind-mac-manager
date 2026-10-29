import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { PublicOperationError } from "@server/common/public-error"
import { DATABASE_FILE } from "@server/env"
import type {
  AiCallMessage,
  AiCallSession,
  AiCallStatus,
} from "@shared/api-contract"

/**
 * AI 通话存储：会话与消息两张表，表名统一带 ai_call_ 前缀。
 *
 * 与 AI 话题不同，通话没有线程：一次通话一段上下文，消息按 seq 线性排列。
 * Pi 的会话条目（JSONL）也按会话保存，重启后据此恢复完整上下文。
 *
 * 打断需要单独记一笔：用户打断时本轮回答可能还没落盘（assistant 的
 * message_end 还没到），所以先在会话上记 interrupted_at，等执行收尾写完
 * 最后一条回答后再回去给它打标记。
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ai_call_session (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    entries TEXT NOT NULL DEFAULT '',
    request_id TEXT,
    interrupted_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    finished_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS ai_call_message (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    body TEXT NOT NULL,
    seq INTEGER NOT NULL,
    interrupted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ai_call_message_session
    ON ai_call_message (session_id, seq);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_call_request
    ON ai_call_session (request_id) WHERE request_id IS NOT NULL;
`

export const AI_CALL_TITLE_MAX = 200
export const AI_CALL_BODY_MAX = 20_000
/** 单次读取的消息上限：一次最多返回这么多条，避免整段历史一次拉回。 */
export const AI_CALL_MESSAGE_LIMIT = 500
/**
 * 会话条目（JSONL）上限。超过它就不能再可靠保存上下文，
 * 必须明确报错，不能让用户以为历史还在。
 */
export const AI_CALL_ENTRIES_MAX_BYTES = 16 * 1024 * 1024

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
      "UPDATE ai_call_session SET status='unknown', updated_at=? WHERE status='running'"
    )
    .run(Date.now())
  return database
}

type SessionRow = {
  id: string
  title: string
  status: string
  entries: string
  request_id: string | null
  interrupted_at: number | null
  created_at: number
  updated_at: number
  finished_at: number | null
  message_count: number
}

type MessageRow = {
  id: string
  session_id: string
  role: string
  body: string
  seq: number
  interrupted: number
  created_at: number
}

const isStatus = (value: string): value is AiCallStatus =>
  value === "idle" ||
  value === "running" ||
  value === "done" ||
  value === "unknown"

const SESSION_SELECT = `
  SELECT s.*,
    (SELECT COUNT(*) FROM ai_call_message m WHERE m.session_id = s.id)
      AS message_count
  FROM ai_call_session s
`

const toSession = (row: SessionRow): AiCallSession => {
  if (!isStatus(row.status)) {
    throw new PublicOperationError(500, "通话记录状态非法")
  }
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    messageCount: row.message_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    interruptedAt: row.interrupted_at,
  }
}

const toMessage = (row: MessageRow): AiCallMessage => ({
  id: row.id,
  role: row.role === "agent" ? "agent" : "user",
  body: row.body,
  interrupted: row.interrupted === 1,
  createdAt: row.created_at,
})

const readSessionRow = (sessionId: string): SessionRow => {
  const row = db().prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(sessionId) as
    | SessionRow
    | undefined
  if (!row) throw new PublicOperationError(404, "通话记录不存在")
  return row
}

/** 没有指定标题时按开始时间生成，用户不必先想名字再开口。 */
const defaultTitle = (now: number): string => {
  const at = new Date(now)
  const pad = (value: number): string => String(value).padStart(2, "0")
  const month = at.getMonth() + 1
  return `通话 ${month}月${at.getDate()}日 ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

export const listCallSessions = (): AiCallSession[] =>
  (
    db()
      .prepare(`${SESSION_SELECT} ORDER BY s.updated_at DESC LIMIT 100`)
      .all() as SessionRow[]
  ).map(toSession)

export const getCallSession = (sessionId: string): AiCallSession =>
  toSession(readSessionRow(sessionId))

export const createCallSession = (title?: string): AiCallSession => {
  const now = Date.now()
  const trimmed = title?.trim() ?? ""
  if (trimmed.length > AI_CALL_TITLE_MAX) {
    throw new PublicOperationError(400, "通话标题过长")
  }
  const id = randomUUID()
  db()
    .prepare(
      `INSERT INTO ai_call_session(
         id, title, status, entries, request_id, interrupted_at,
         created_at, updated_at, finished_at
       ) VALUES (?, ?, 'idle', '', NULL, NULL, ?, ?, NULL)`
    )
    .run(id, trimmed || defaultTitle(now), now, now)
  return getCallSession(id)
}

export const renameCallSession = (
  sessionId: string,
  title: string
): AiCallSession => {
  const trimmed = title.trim()
  if (!trimmed) throw new PublicOperationError(400, "通话标题不能为空")
  if (trimmed.length > AI_CALL_TITLE_MAX) {
    throw new PublicOperationError(400, "通话标题过长")
  }
  readSessionRow(sessionId)
  db()
    .prepare(
      "UPDATE ai_call_session SET title = ?, updated_at = ? WHERE id = ?"
    )
    .run(trimmed, Date.now(), sessionId)
  return getCallSession(sessionId)
}

/** 挂断：只记时间，历史保留；再次开口会新开一次通话。 */
export const finishCallSession = (sessionId: string): AiCallSession => {
  readSessionRow(sessionId)
  db()
    .prepare(
      "UPDATE ai_call_session SET finished_at = ?, updated_at = ? WHERE id = ?"
    )
    .run(Date.now(), Date.now(), sessionId)
  return getCallSession(sessionId)
}

/** 删除通话：连同消息一起删；正在执行的通话必须先停止。 */
export const deleteCallSession = (sessionId: string): void => {
  const row = readSessionRow(sessionId)
  if (row.status === "running") {
    throw new PublicOperationError(409, "通话正在进行，请先停止再删除")
  }
  db().exec("BEGIN")
  try {
    db()
      .prepare("DELETE FROM ai_call_message WHERE session_id = ?")
      .run(sessionId)
    db().prepare("DELETE FROM ai_call_session WHERE id = ?").run(sessionId)
    db().exec("COMMIT")
  } catch (error) {
    db().exec("ROLLBACK")
    throw error
  }
}

export const listCallMessages = (
  sessionId: string,
  limit = AI_CALL_MESSAGE_LIMIT
): AiCallMessage[] => {
  readSessionRow(sessionId)
  // 先按倒序取最近 limit 条，再翻回正序显示。
  const rows = db()
    .prepare(
      `SELECT * FROM ai_call_message WHERE session_id = ?
       ORDER BY seq DESC LIMIT ?`
    )
    .all(sessionId, Math.min(limit, AI_CALL_MESSAGE_LIMIT)) as MessageRow[]
  return rows.reverse().map(toMessage)
}

/** 最后一条消息；没有消息时返回 null。 */
const lastMessageRow = (sessionId: string): MessageRow | null => {
  const row = db()
    .prepare(
      `SELECT * FROM ai_call_message WHERE session_id = ?
       ORDER BY seq DESC LIMIT 1`
    )
    .get(sessionId) as MessageRow | undefined
  return row ?? null
}

/** 追加一条消息；seq 在事务里按会话分配，保证会话内严格递增。 */
export const appendCallMessage = (input: {
  sessionId: string
  role: "user" | "agent"
  body: string
}): AiCallMessage => {
  const body = input.body
  if (!body.trim()) throw new PublicOperationError(400, "消息内容不能为空")
  if (body.length > AI_CALL_BODY_MAX) {
    throw new PublicOperationError(400, "消息内容过长")
  }
  readSessionRow(input.sessionId)
  const now = Date.now()
  db().exec("BEGIN")
  try {
    const next = db()
      .prepare(
        `SELECT COALESCE(MAX(seq), 0) + 1 AS next
         FROM ai_call_message WHERE session_id = ?`
      )
      .get(input.sessionId) as { next: number } | undefined
    const id = randomUUID()
    db()
      .prepare(
        `INSERT INTO ai_call_message(
           id, session_id, role, body, seq, interrupted, created_at
         ) VALUES (?, ?, ?, ?, ?, 0, ?)`
      )
      .run(id, input.sessionId, input.role, body, next?.next ?? 1, now)
    db()
      .prepare("UPDATE ai_call_session SET updated_at = ? WHERE id = ?")
      .run(now, input.sessionId)
    db().exec("COMMIT")
    const row = db()
      .prepare("SELECT * FROM ai_call_message WHERE id = ?")
      .get(id) as MessageRow
    return toMessage(row)
  } catch (error) {
    db().exec("ROLLBACK")
    throw error
  }
}

/**
 * 写入本轮回答的当前内容。
 *
 * 执行过程中会被反复调用，所以不能每次都追加：最后一条是 agent 就覆盖它，
 * 是 user 才新建。这样一次执行只会留下一条回答，不会把中间过程摊成几十条。
 */
export const saveCallAnswer = (sessionId: string, answer: string): void => {
  if (!answer.trim()) return
  if (answer.length > AI_CALL_BODY_MAX) return
  const last = lastMessageRow(sessionId)
  const now = Date.now()
  if (last && last.role === "agent") {
    db()
      .prepare("UPDATE ai_call_message SET body = ? WHERE id = ?")
      .run(answer, last.id)
    return
  }
  appendCallMessage({ sessionId, role: "agent", body: answer })
  db()
    .prepare("UPDATE ai_call_session SET updated_at = ? WHERE id = ?")
    .run(now, sessionId)
}

/**
 * 收尾：写终态，并把「被打断」落到最后一条回答上。
 *
 * 打断时回答可能还没落盘，所以标记只能等到这里——本条回答确定之后
 * 才能给它打 interrupted，否则会标到上一条上。
 */
export const finishCallRun = (
  sessionId: string,
  status: "done" | "unknown",
  answer?: string | null
): void => {
  const now = Date.now()
  if (answer?.trim()) saveCallAnswer(sessionId, answer)
  const row = readSessionRow(sessionId)
  if (status === "unknown" && row.interrupted_at !== null) {
    const last = lastMessageRow(sessionId)
    if (last && last.role === "agent") {
      db()
        .prepare("UPDATE ai_call_message SET interrupted = 1 WHERE id = ?")
        .run(last.id)
    }
  }
  db()
    .prepare(
      `UPDATE ai_call_session
       SET status = ?, request_id = NULL, updated_at = ?
       WHERE id = ? AND status = 'running'`
    )
    .run(status, now, sessionId)
}

export const setCallStatus = (
  sessionId: string,
  status: AiCallStatus
): void => {
  db()
    .prepare(
      "UPDATE ai_call_session SET status = ?, updated_at = ? WHERE id = ?"
    )
    .run(status, Date.now(), sessionId)
}

/** 执行前落库请求标识：同一标识不会产生第二次执行。 */
export const startCallRun = (
  sessionId: string,
  requestId: string | null
): void => {
  readSessionRow(sessionId)
  db()
    .prepare(
      `UPDATE ai_call_session
       SET status = 'running', request_id = ?, interrupted_at = NULL,
           finished_at = NULL, updated_at = ?
       WHERE id = ?`
    )
    .run(requestId, Date.now(), sessionId)
}

/** 记下被打断：真正落到消息上的标记在 finishCallRun 里补。 */
export const markCallInterrupted = (sessionId: string): void => {
  db()
    .prepare("UPDATE ai_call_session SET interrupted_at = ? WHERE id = ?")
    .run(Date.now(), sessionId)
}

/** 按请求标识判断是否已经提交过：服务重启后也不能重跑同一个请求。 */
export const findCallSessionByRequestId = (
  requestId: string
): { id: string } | null => {
  const row = db()
    .prepare("SELECT id FROM ai_call_session WHERE request_id = ?")
    .get(requestId) as { id: string } | undefined
  return row ?? null
}

export const readCallEntries = (sessionId: string): string =>
  readSessionRow(sessionId).entries

/** 保存会话条目；超过上限直接报错，不写入半份历史。 */
export const saveCallEntries = (sessionId: string, entries: string): void => {
  if (Buffer.byteLength(entries, "utf8") > AI_CALL_ENTRIES_MAX_BYTES) {
    throw new PublicOperationError(
      409,
      "通话历史过大，无法继续保存上下文；请开始新的通话"
    )
  }
  db()
    .prepare(
      "UPDATE ai_call_session SET entries = ?, updated_at = ? WHERE id = ?"
    )
    .run(entries, Date.now(), sessionId)
}
