import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { PublicOperationError } from "@server/common/public-error"
import { DATABASE_FILE } from "@server/env"
import type { AiCallPersona } from "@shared/api-contract"

/**
 * 通话角色：一套提示词加自己的模型。
 *
 * 与 AI 助手的设置完全分开：助手是操作台，通话角色是聊天对象，
 * 可以有多个，每个用不同模型与语气，用户选一个开始通话。
 *
 * 不内置默认角色：没有角色就不能开始通话，避免又退回到「和助手同一个身份」。
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ai_call_persona (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    system_prompt TEXT NOT NULL DEFAULT '',
    provider_id TEXT,
    model_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`

let database: DatabaseSync | null = null

const db = (): DatabaseSync => {
  if (database) return database
  mkdirSync(path.dirname(DATABASE_FILE), { recursive: true })
  const opened = new DatabaseSync(DATABASE_FILE, { timeout: 5000 })
  opened.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;${SCHEMA}`)
  database = opened
  return database
}

type PersonaRow = {
  id: string
  name: string
  system_prompt: string
  provider_id: string | null
  model_id: string | null
  created_at: number
  updated_at: number
}

const toPersona = (row: PersonaRow): AiCallPersona => ({
  id: row.id,
  name: row.name,
  systemPrompt: row.system_prompt,
  providerId: row.provider_id,
  modelId: row.model_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export const listCallPersonas = (): AiCallPersona[] =>
  (
    db()
      .prepare("SELECT * FROM ai_call_persona ORDER BY created_at ASC")
      .all() as PersonaRow[]
  ).map(toPersona)

export const getCallPersona = (id: string): AiCallPersona | null => {
  const row = db()
    .prepare("SELECT * FROM ai_call_persona WHERE id = ?")
    .get(id) as PersonaRow | undefined
  return row ? toPersona(row) : null
}

/** 会话要用到角色时调用：角色被删掉就明确报错，不静默换成别的身份。 */
export const requireCallPersona = (id: string): AiCallPersona => {
  const persona = getCallPersona(id)
  if (!persona) {
    throw new PublicOperationError(404, "这次通话的角色已被删除，请新建通话")
  }
  return persona
}

export const createCallPersona = (input: {
  name: string
  systemPrompt: string
  providerId?: string
  modelId?: string
}): AiCallPersona => {
  const id = randomUUID()
  const now = Date.now()
  db()
    .prepare(
      `INSERT INTO ai_call_persona
       (id, name, system_prompt, provider_id, model_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.name.trim(),
      input.systemPrompt,
      input.providerId ?? null,
      input.modelId ?? null,
      now,
      now
    )
  return requireCallPersona(id)
}

export const updateCallPersona = (
  id: string,
  input: {
    name: string
    systemPrompt: string
    providerId?: string
    modelId?: string
  }
): AiCallPersona => {
  requireCallPersona(id)
  db()
    .prepare(
      `UPDATE ai_call_persona
       SET name=?, system_prompt=?, provider_id=?, model_id=?, updated_at=?
       WHERE id=?`
    )
    .run(
      input.name.trim(),
      input.systemPrompt,
      input.providerId ?? null,
      input.modelId ?? null,
      Date.now(),
      id
    )
  return requireCallPersona(id)
}

export const deleteCallPersona = (id: string): void => {
  requireCallPersona(id)
  db().prepare("DELETE FROM ai_call_persona WHERE id=?").run(id)
}
