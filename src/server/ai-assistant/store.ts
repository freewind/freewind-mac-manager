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
  database = new DatabaseSync(DATABASE_FILE, { timeout: 5000 })
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS ai_assistant_session (
      id TEXT PRIMARY KEY,
      settings_snapshot TEXT NOT NULL,
      messages TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'idle',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );`)
  // 建表/连上后立刻清一次孤立记录，之后同一进程里不会再有 running。
  markOrphanRunsUnknown()
  return database
}

export type AiAssistantSessionStatus = AiAssistantSession["status"]

export type SessionSnapshot = {
  id: string
  settingsSnapshot: unknown
  messages: unknown[]
  status: AiAssistantSessionStatus
  createdAt: number
  updatedAt: number
}

type SessionRow = {
  id: string
  settings_snapshot: string
  messages: string
  status: string
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
 * 开始一次运行：把用户输入写进历史并置为 running。
 * 先写库再发请求：写不进去就不该开始执行（否则会出现删了历史仍在跑的孤儿）。
 */
export const startSessionRun = (
  id: string,
  userMessage: unknown
): SessionSnapshot => {
  const session = readSession(id)
  const result = db()
    .prepare(
      "UPDATE ai_assistant_session SET messages=?, status='running', updated_at=? WHERE id=?"
    )
    .run(JSON.stringify([...session.messages, userMessage]), Date.now(), id)
  if (result.changes === 0) throw new PublicOperationError(404, "会话不存在")
  return readSession(id)
}

/** 结束一次运行：可选补上已经拿到的回答，并写终态（done / unknown）。 */
export const finishSessionRun = (
  id: string,
  status: "done" | "unknown",
  answer?: string | null
): SessionSnapshot => {
  const session = readSession(id)
  const messages = answer
    ? [...session.messages, { role: "assistant", text: answer }]
    : session.messages
  const result = db()
    .prepare(
      "UPDATE ai_assistant_session SET messages=?, status=?, updated_at=? WHERE id=?"
    )
    .run(JSON.stringify(messages), status, Date.now(), id)
  if (result.changes === 0) throw new PublicOperationError(404, "会话不存在")
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
