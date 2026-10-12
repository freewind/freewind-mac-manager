import { mkdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { PublicOperationError } from "@server/common/public-error"
import { DATABASE_FILE } from "@server/env"
import type { AiAssistantSessionSummary as AiAssistantSession } from "@shared/api-contract"
import { AiAssistantSessionSchema } from "@shared/api-contract/schemas/ai-assistant"

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const LIST_LIMIT = 50

let database: DatabaseSync | null = null

/**
 * 进程刚启动时不可能有正在执行的内存会话：残留的 running 都是上次服务中断
 * 留下的，一律标成「结果未知」，不能让它们继续冒充执行中。
 */
const markOrphanRunsUnknown = (): void => {
  database
    ?.prepare(
      "UPDATE ai_assistant_session SET status='unknown', updated_at=? WHERE status='running'"
    )
    .run(Date.now())
}

const db = (): DatabaseSync => {
  if (database) return database
  mkdirSync(path.dirname(DATABASE_FILE), { recursive: true })
  const opened = new DatabaseSync(DATABASE_FILE, { timeout: 5000 })
  opened.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS ai_assistant_session (
      id TEXT PRIMARY KEY,
      settings_snapshot TEXT NOT NULL,
      messages TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'idle',
      request_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );`)
  ensureRequestIdColumn(opened)
  database = opened
  // 建表/连上后立刻清一次孤立记录，之后同一进程里不会再有 running。
  markOrphanRunsUnknown()
  return database
}

/**
 * 请求标识列迁移：早期版本的表没有 request_id。老库补列而不是重建，
 * 已有记录保持不动；唯一索引只对非空值生效，历史数据不受影响。
 */
const ensureRequestIdColumn = (target: DatabaseSync): void => {
  const columns = target
    .prepare("PRAGMA table_info(ai_assistant_session)")
    .all() as { name: string }[]
  if (!columns.some((column) => column.name === "request_id")) {
    target.exec("ALTER TABLE ai_assistant_session ADD COLUMN request_id TEXT")
  }
  target.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_assistant_session_request
     ON ai_assistant_session (request_id) WHERE request_id IS NOT NULL`
  )
}

export type AiAssistantSessionStatus = AiAssistantSession["status"]

export type SessionSnapshot = {
  id: string
  settingsSnapshot: unknown
  messages: unknown[]
  status: AiAssistantSessionStatus
  /** 本次运行的请求标识；重复提交据此复用同一次执行。 */
  requestId: string | null
  createdAt: number
  updatedAt: number
}

type SessionRow = {
  id: string
  settings_snapshot: string
  messages: string
  status: string
  request_id: string | null
  created_at: number
  updated_at: number
}

const isStatus = (value: string): value is AiAssistantSessionStatus =>
  value === "idle" ||
  value === "running" ||
  value === "done" ||
  value === "unknown"

const toSnapshot = (row: SessionRow): SessionSnapshot => {
  if (!isStatus(row.status))
    throw new PublicOperationError(500, "会话记录状态非法")
  return {
    id: row.id,
    settingsSnapshot: JSON.parse(row.settings_snapshot),
    messages: JSON.parse(row.messages) as unknown[],
    status: row.status,
    requestId: row.request_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 插入前顺手清理过期记录：只在写入路径上做，读路径不承担维护成本。 */
const applyRetention = (): void => {
  db()
    .prepare(
      "DELETE FROM ai_assistant_session WHERE updated_at < ? AND status <> 'running'"
    )
    .run(Date.now() - RETENTION_MS)
}

export const saveSession = (input: {
  id: string
  settingsSnapshot: unknown
  messages?: unknown[]
  status?: AiAssistantSessionStatus
  createdAt?: number
  updatedAt?: number
}): SessionSnapshot => {
  applyRetention()
  const now = Date.now()
  const messages = input.messages ?? []
  const status = input.status ?? "idle"
  const createdAt = input.createdAt ?? now
  const updatedAt = input.updatedAt ?? now
  db()
    .prepare(
      `INSERT INTO ai_assistant_session(
         id, settings_snapshot, messages, status, created_at, updated_at
       ) VALUES(?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         settings_snapshot=excluded.settings_snapshot,
         messages=excluded.messages,
         status=excluded.status,
         updated_at=excluded.updated_at`
    )
    .run(
      input.id,
      JSON.stringify(input.settingsSnapshot),
      JSON.stringify(messages),
      status,
      createdAt,
      updatedAt
    )
  return readSession(input.id)
}

/** 按请求标识查会话：重复提交据此复用同一次执行，不产生第二次副作用。 */
export const findSessionByRequestId = (
  requestId: string
): SessionSnapshot | null => {
  const row = db()
    .prepare("SELECT * FROM ai_assistant_session WHERE request_id=?")
    .get(requestId) as SessionRow | undefined
  return row ? toSnapshot(row) : null
}

export const readSession = (id: string): SessionSnapshot => {
  const row = db()
    .prepare("SELECT * FROM ai_assistant_session WHERE id=?")
    .get(id) as SessionRow | undefined
  if (!row) throw new PublicOperationError(404, "会话不存在")
  return toSnapshot(row)
}

export const listSessions = (): AiAssistantSession[] =>
  (
    db()
      .prepare(
        "SELECT * FROM ai_assistant_session ORDER BY updated_at DESC LIMIT ?"
      )
      .all(LIST_LIMIT) as SessionRow[]
  ).map((row) => {
    const snapshot = toSnapshot(row)
    return AiAssistantSessionSchema.parse({
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      status: snapshot.status,
      messageCount: snapshot.messages.length,
    })
  })

export const clearSession = (id: string): void => {
  const row = db()
    .prepare("SELECT status FROM ai_assistant_session WHERE id=?")
    .get(id)
  if (!row) throw new PublicOperationError(404, "会话不存在")
  // 正在执行的会话不能删：删掉历史不代表上游停下，会留下无法核实的半成品。
  if (String(row.status) === "running") {
    throw new PublicOperationError(409, "会话正在执行，请先中止再清空")
  }
  const result = db()
    .prepare("DELETE FROM ai_assistant_session WHERE id=?")
    .run(id)
  if (result.changes === 0) throw new PublicOperationError(404, "会话不存在")
}

/**
 * 把回答并进消息列表：末尾已经是助手消息就替换它，否则追加。
 * 执行中会反复落盘同一段回答，不能每次追加出一条新的助手消息。
 */
const withAnswer = (messages: unknown[], answer: string): unknown[] => {
  const last = messages[messages.length - 1] as { role?: unknown } | undefined
  const next = { role: "assistant", text: answer }
  if (last && typeof last === "object" && last.role === "assistant") {
    return [...messages.slice(0, -1), next]
  }
  return [...messages, next]
}

/**
 * 开始一次运行：把用户输入与请求标识写进历史并置为 running。
 * 先写库再发请求：写不进去就不该开始执行（否则会出现删了历史仍在跑的孤儿）。
 */
export const startSessionRun = (
  id: string,
  userMessage: unknown,
  requestId: string | null = null
): SessionSnapshot => {
  const session = readSession(id)
  const result = db()
    .prepare(
      `UPDATE ai_assistant_session
       SET messages=?, status='running', request_id=?, updated_at=?
       WHERE id=?`
    )
    .run(
      JSON.stringify([...session.messages, userMessage]),
      requestId,
      Date.now(),
      id
    )
  if (result.changes === 0) throw new PublicOperationError(404, "会话不存在")
  return readSession(id)
}

/**
 * 结束一次运行：可选补上已经拿到的回答，并写终态（done / unknown）。
 *
 * 只有仍在 running 的记录会被改写：终态只写一次，后到的收尾（例如断连与
 * 显式停止同时发生）不会覆盖已经确认的结果。
 */
export const finishSessionRun = (
  id: string,
  status: "done" | "unknown",
  answer?: string | null
): SessionSnapshot => {
  const session = readSession(id)
  if (session.status !== "running") return session
  const messages = answer
    ? withAnswer(session.messages, answer)
    : session.messages
  db()
    .prepare(
      `UPDATE ai_assistant_session
       SET messages=?, status=?, updated_at=?
       WHERE id=? AND status='running'`
    )
    .run(JSON.stringify(messages), status, Date.now(), id)
  return readSession(id)
}

/**
 * 执行过程中持续落盘：把已经拿到的回答写进历史，崩溃或断连后至少能看到
 * 部分内容。只在 running 时生效，也只替换末尾那条助手消息。
 */
export const saveSessionAnswer = (
  id: string,
  answer: string
): SessionSnapshot => {
  const session = readSession(id)
  if (session.status !== "running") return session
  db()
    .prepare(
      `UPDATE ai_assistant_session SET messages=?, updated_at=?
       WHERE id=? AND status='running'`
    )
    .run(JSON.stringify(withAnswer(session.messages, answer)), Date.now(), id)
  return readSession(id)
}

export const appendMessage = (
  sessionId: string,
  message: unknown
): SessionSnapshot => {
  const session = readSession(sessionId)
  const messages = [...session.messages, message]
  const updatedAt = Date.now()
  db()
    .prepare(
      "UPDATE ai_assistant_session SET messages=?, updated_at=? WHERE id=?"
    )
    .run(JSON.stringify(messages), updatedAt, sessionId)
  return readSession(sessionId)
}
