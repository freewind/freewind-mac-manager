import { createHash } from "node:crypto"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { PublicOperationError } from "@server/common/public-error"
import { DATABASE_FILE } from "@server/env"
import type {
  AiTopicSettings,
  AiTopicSettingsResponse,
} from "@shared/api-contract"
import {
  AiTopicSettingsMutationSchema,
  AiTopicSettingsResponseSchema,
} from "@shared/api-contract/schemas/ai-topic"
import { AI_TOPIC_DEFAULT_SYSTEM_PROMPT } from "./config"

/**
 * 话题自己的 AI 配置。
 *
 * 与 AI 助手的设置是两张表：两处各用各的模型与提示词，改一边不会影响
 * 另一边。只存应用数据库，不写 Pi 的 settings.json。
 */
const DEFAULTS = {
  systemPrompt: AI_TOPIC_DEFAULT_SYSTEM_PROMPT,
} as const

let database: DatabaseSync | null = null

const db = (): DatabaseSync => {
  if (database) return database
  mkdirSync(path.dirname(DATABASE_FILE), { recursive: true })
  database = new DatabaseSync(DATABASE_FILE, { timeout: 5000 })
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS ai_topic_settings (
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
      "SELECT settings, signature, updated_at FROM ai_topic_settings WHERE id=1"
    )
    .get() as SettingsRow | undefined

/** 固定按键序序列化：同一份内容总是得到同一份 signature。 */
const serialize = (settings: AiTopicSettings): string =>
  JSON.stringify(
    Object.keys(settings)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = settings[key as keyof AiTopicSettings]
        return acc
      }, {})
  )

const toResponse = (row: SettingsRow): AiTopicSettingsResponse =>
  AiTopicSettingsResponseSchema.parse({
    settings: JSON.parse(row.settings),
    signature: row.signature,
    updatedAt: row.updated_at,
    defaults: DEFAULTS,
  })

export const getAiTopicSettings = (): AiTopicSettingsResponse => {
  const row = readRow()
  if (row) return toResponse(row)
  // 首次读取落默认行：后续写入的乐观锁都对着同一条记录工作。
  const raw = serialize({})
  const signature = sign(raw)
  const updatedAt = Date.now()
  db()
    .prepare(
      `INSERT INTO ai_topic_settings(id, settings, signature, updated_at)
       VALUES(1, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    )
    .run(raw, signature, updatedAt)
  const inserted = readRow()
  return toResponse(
    inserted ?? { settings: raw, signature, updated_at: updatedAt }
  )
}

export const saveAiTopicSettings = (
  input: unknown
): AiTopicSettingsResponse => {
  const mutation = AiTopicSettingsMutationSchema.safeParse(input)
  if (!mutation.success)
    throw new PublicOperationError(400, "话题设置未通过校验")
  const { providerId, modelId } = mutation.data.settings
  if (providerId !== undefined && providerId.trim() === "")
    throw new PublicOperationError(400, "providerId 不能为空白")
  if (modelId !== undefined && modelId.trim() === "")
    throw new PublicOperationError(400, "modelId 不能为空白")
  const current = readRow()
  if (!current)
    throw new PublicOperationError(404, "话题设置记录不存在，请先读取")
  if (current.signature !== mutation.data.signature)
    throw new PublicOperationError(
      409,
      "话题设置已被其他程序修改，请刷新后重试"
    )
  const previous = JSON.parse(current.settings) as AiTopicSettings
  const settings: AiTopicSettings = { ...previous, ...mutation.data.settings }
  for (const field of mutation.data.clearFields) delete settings[field]
  const raw = serialize(settings)
  const signature = sign(raw)
  const updatedAt = Date.now()
  db().exec("BEGIN")
  try {
    db()
      .prepare(
        `UPDATE ai_topic_settings
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
  if (!saved) throw new PublicOperationError(500, "话题设置写入失败")
  return toResponse(saved)
}

/**
 * 会话用的系统提示词：未自定义时用话题默认规则；自定义时在用户提示词后
 * 追加线程工具规则。
 *
 * 用户只写自己的角色与风格，不知道有线程工具；这段固定规则不能随自定义
 * 一起丢掉，否则「必须用 reply_thread 写入线程」的约束会失效。
 */
export const buildTopicSystemPrompt = (
  settings: AiTopicSettingsResponse
): string => {
  const custom = settings.settings.systemPrompt?.trim()
  if (!custom) return DEFAULTS.systemPrompt
  return `${custom}\n\n${TOPIC_TOOL_RULES}`
}

const TOPIC_TOOL_RULES = `线程工具规则（必须遵守）：
1. 回答用户问题时必须调用 reply_thread 把内容写进线程，不要只在正文里直接作答；threadId 省略表示本次提问所在线程。
2. 一个问题里包含多个互不相关的问题时，用 create_thread 分别建线程，再用 reply_thread 把答案写进对应线程。
3. 需要确认线程 id 时先调用 list_threads；线程标题失效用 rename_thread；已解决不再跟进用 archive_thread。
4. 所有线程共享同一对话上下文：你在任何线程里讨论过的内容都仍然有效。
5. 你不能删除线程或话题；用户要求删除时，让他在界面上确认。`
