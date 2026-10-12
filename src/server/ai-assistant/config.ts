import { createHash } from "node:crypto"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { PublicOperationError } from "@server/common/public-error"
import { DATABASE_FILE } from "@server/env"
import type {
  AiAssistantSettingsDocument as AiAssistantSettings,
  AiAssistantSettingsResponse,
} from "@shared/api-contract"
import {
  AI_ASSISTANT_DEFAULT_TOOLS,
  AiAssistantSettingsMutationSchema,
  AiAssistantSettingsResponseSchema,
} from "@shared/api-contract/schemas/ai-assistant"

export const AI_ASSISTANT_DEFAULT_SYSTEM_PROMPT = `你是 freewind-mac-manager 的 AI 操作助手。用户通过本应用与你对话，你能查看和操作本机的流量、磁盘、进程、端口、文件、系统服务、Docker 容器、Caddy、FRP 等功能。

优先使用 call_mac_manager_api 工具操作应用能力：它通过本应用 API（127.0.0.1）调用，自带访问鉴权、入参校验、任务运行时和危险动作确认，覆盖全部只读与写操作端点。

当应用 API 无法满足（如读取项目源码、运行 git 命令、查看本机任意文件）时，可使用内置的 read/bash/write/edit/grep/ls 工具，工作目录限定在项目根。

规则：危险动作（杀进程、删文件、重启服务、覆盖配置）必须说明目标与影响；写操作不自动重试；请求中断标"结果未知"；敏感信息不写入日志。`

const AI_ASSISTANT_DEFAULTS = {
  systemPrompt: AI_ASSISTANT_DEFAULT_SYSTEM_PROMPT,
  enabledTools: [...AI_ASSISTANT_DEFAULT_TOOLS],
} as const

let database: DatabaseSync | null = null

const db = (): DatabaseSync => {
  if (database) return database
  mkdirSync(path.dirname(DATABASE_FILE), { recursive: true })
  database = new DatabaseSync(DATABASE_FILE, { timeout: 5000 })
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS ai_assistant_settings (
      id INTEGER PRIMARY KEY CHECK(id=1),
      settings TEXT NOT NULL,
      signature TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );`)
  return database
}

const sign = (raw: string): string =>
  createHash("sha256").update(raw).digest("hex")

type SettingsRow = {
  settings: string
  signature: string
  updated_at: number
}

const readRow = (): SettingsRow | undefined =>
  db()
    .prepare(
      "SELECT settings, signature, updated_at FROM ai_assistant_settings WHERE id=1"
    )
    .get() as SettingsRow | undefined

/** settings 文本固定按键序序列化：同一份内容总是得到同一份 signature。 */
const serialize = (settings: AiAssistantSettings): string =>
  JSON.stringify(
    Object.keys(settings)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = settings[key as keyof AiAssistantSettings]
        return acc
      }, {})
  )

const toResponse = (row: {
  settings: string
  signature: string
  updated_at: number
}): AiAssistantSettingsResponse =>
  AiAssistantSettingsResponseSchema.parse({
    settings: JSON.parse(row.settings),
    signature: row.signature,
    updatedAt: row.updated_at,
    defaults: AI_ASSISTANT_DEFAULTS,
  })

export const getAiAssistantSettings = (): AiAssistantSettingsResponse => {
  const row = readRow()
  if (row) return toResponse(row)
  // 首次读取时落默认行：后续写入的乐观锁都对着同一条记录工作。
  const settings: AiAssistantSettings = {}
  const raw = serialize(settings)
  const signature = sign(raw)
  const updatedAt = Date.now()
  db()
    .prepare(
      `INSERT INTO ai_assistant_settings(id, settings, signature, updated_at)
       VALUES(1, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    )
    .run(raw, signature, updatedAt)
  const inserted = readRow()
  return toResponse(
    inserted ?? { settings: raw, signature, updated_at: updatedAt }
  )
}

export const saveAiAssistantSettings = (
  input: unknown
): AiAssistantSettingsResponse => {
  const mutation = AiAssistantSettingsMutationSchema.safeParse(input)
  if (!mutation.success)
    throw new PublicOperationError(400, "AI 助手设置未通过校验")
  const { providerId, modelId } = mutation.data.settings
  if (providerId !== undefined && providerId.trim() === "")
    throw new PublicOperationError(400, "providerId 不能为空白")
  if (modelId !== undefined && modelId.trim() === "")
    throw new PublicOperationError(400, "modelId 不能为空白")
  const current = readRow()
  if (!current)
    throw new PublicOperationError(404, "AI 助手设置记录不存在，请先读取")
  if (current.signature !== mutation.data.signature)
    throw new PublicOperationError(
      409,
      "AI 助手设置已被其他程序修改，请刷新后重试"
    )
  const previous = JSON.parse(current.settings) as AiAssistantSettings
  const settings: AiAssistantSettings = {
    ...previous,
    ...mutation.data.settings,
  }
  for (const field of mutation.data.clearFields) delete settings[field]
  const raw = serialize(settings)
  const signature = sign(raw)
  const updatedAt = Date.now()
  db().exec("BEGIN")
  try {
    db()
      .prepare(
        `UPDATE ai_assistant_settings
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
  if (!saved) throw new PublicOperationError(500, "AI 助手设置写入失败")
  return toResponse(saved)
}
