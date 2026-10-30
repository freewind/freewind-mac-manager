import { createHash } from "node:crypto"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { PublicOperationError } from "@server/common/public-error"
import { DATABASE_FILE } from "@server/env"
import type {
  AiCallSettings,
  AiCallSettingsResponse,
} from "@shared/api-contract"
import {
  AiCallSettingsMutationSchema,
  AiCallSettingsResponseSchema,
} from "@shared/api-contract/schemas/ai-call"
import { AI_CALL_DEFAULT_SYSTEM_PROMPT, AI_CALL_SPEAK_RULES } from "./config"

/**
 * 通话自己的 AI 配置。
 *
 * 与 AI 助手的设置是两张表：改助手不会影响打电话的语气与打断规则。
 * 只存应用数据库，不写 Pi 的 settings.json。
 *
 * 模型不在其中：通话沿用助手那份模型设置，避免用户再挑一次。
 */
const DEFAULTS = {
  systemPrompt: AI_CALL_DEFAULT_SYSTEM_PROMPT,
} as const

let database: DatabaseSync | null = null

const db = (): DatabaseSync => {
  if (database) return database
  mkdirSync(path.dirname(DATABASE_FILE), { recursive: true })
  database = new DatabaseSync(DATABASE_FILE, { timeout: 5000 })
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS ai_call_settings (
      id INTEGER PRIMARY KEY CHECK(id=1),
      settings TEXT NOT NULL,
      signature TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );`)
  return database
}

const sign = (raw: string): string =>
  createHash("sha256").update(raw).digest("hex")

type SettingsRow = { settings: string; signature: string; updated_at: number }

const readRow = (): SettingsRow | undefined =>
  db()
    .prepare(
      "SELECT settings, signature, updated_at FROM ai_call_settings WHERE id=1"
    )
    .get() as SettingsRow | undefined

/** 固定按键序序列化：同一份内容总是得到同一份 signature。 */
const serialize = (settings: AiCallSettings): string =>
  JSON.stringify(
    Object.keys(settings)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = settings[key as keyof AiCallSettings]
        return acc
      }, {})
  )

const toResponse = (row: SettingsRow): AiCallSettingsResponse =>
  AiCallSettingsResponseSchema.parse({
    settings: JSON.parse(row.settings),
    signature: row.signature,
    updatedAt: row.updated_at,
    defaults: DEFAULTS,
  })

export const getAiCallSettings = (): AiCallSettingsResponse => {
  const row = readRow()
  if (row) return toResponse(row)
  // 首次读取落默认行：后续写入的乐观锁都对着同一条记录工作。
  const raw = serialize({})
  const signature = sign(raw)
  const updatedAt = Date.now()
  db()
    .prepare(
      `INSERT INTO ai_call_settings(id, settings, signature, updated_at)
       VALUES(1, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    )
    .run(raw, signature, updatedAt)
  const inserted = readRow()
  return toResponse(
    inserted ?? { settings: raw, signature, updated_at: updatedAt }
  )
}

export const saveAiCallSettings = (input: unknown): AiCallSettingsResponse => {
  const mutation = AiCallSettingsMutationSchema.safeParse(input)
  if (!mutation.success)
    throw new PublicOperationError(400, "通话设置未通过校验")
  const current = readRow()
  if (!current)
    throw new PublicOperationError(404, "通话设置记录不存在，请先读取")
  if (current.signature !== mutation.data.signature)
    throw new PublicOperationError(
      409,
      "通话设置已被其他程序修改，请刷新后重试"
    )
  const previous = JSON.parse(current.settings) as AiCallSettings
  const settings: AiCallSettings = { ...previous, ...mutation.data.settings }
  for (const field of mutation.data.clearFields) delete settings[field]
  const raw = serialize(settings)
  const signature = sign(raw)
  const updatedAt = Date.now()
  db().exec("BEGIN")
  try {
    db()
      .prepare(
        `UPDATE ai_call_settings
         SET settings=?, signature=?, updated_at=?
         WHERE id=1 AND signature=?`
      )
      .run(raw, signature, updatedAt, current.signature)
    db().exec("COMMIT")
  } catch (error) {
    db().exec("ROLLBACK")
    throw error
  }
  const saved = readRow()
  if (!saved) throw new PublicOperationError(500, "通话设置写入失败")
  return toResponse(saved)
}

/**
 * 会话用的系统提示词：未自定义时用默认那段；自定义时在用户提示词后
 * 追加 speak 规则。
 *
 * 用户只写自己想要的语气与打断习惯，不知道有这个工具；这段固定规则不能
 * 随自定义一起丢掉，否则「只能通过 speak 说话」会失效，通话就会没声音。
 */
export const buildCallSystemPrompt = (
  settings: AiCallSettingsResponse
): string => {
  const custom = settings.settings.systemPrompt?.trim()
  if (!custom) return DEFAULTS.systemPrompt
  return `${custom}\n\n${AI_CALL_SPEAK_RULES}`
}
