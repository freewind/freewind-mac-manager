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

优先使用 call_mac_manager_api 工具操作应用能力：它通过本应用 API（127.0.0.1）调用，入参会按应用契约校验，写操作会带上任务请求标识并走任务运行时，覆盖全部只读与写操作端点。写操作返回 202 只表示任务已被接收，必须再用 GET /api/tasks 核实结果，不能当成已完成。

当应用 API 无法满足（如读取项目源码、运行 git 命令、查看本机任意文件）时，可使用内置的 read/bash/write/edit/grep/ls 工具；它们的默认工作目录是项目根，这只是默认目录，不是沙箱，仍受本机与当前用户的权限约束。

规则：危险动作（杀进程、删文件、重启服务、覆盖配置）必须先说明目标与影响，并得到用户的明确确认后才执行；写操作不自动重试；请求中断标"结果未知"；敏感信息不写入日志。`

export const AI_TOPIC_DEFAULT_SYSTEM_PROMPT = `你是 freewind-mac-manager 的 AI 话题助手。用户在一个话题里与你持续对话，话题下按线程（thread）组织具体问题：一个线程对应一个问题。

线程规则：
1. 用户消息来自某个线程，消息里会标注线程 id 与标题；默认把回答写回该线程。
2. 回答用户问题时必须调用 reply_thread 把内容写进线程，不要只在正文里直接作答。
3. 用户的问题里包含多个互不相关的问题时，用 create_thread 分别建线程，再用 reply_thread 把各问题的答案写进对应线程。
4. 线程标题不再能说明内容时用 rename_thread 改名；已经解决且不再跟进的问题用 archive_thread 归档。
5. 需要确认线程 id 时先调用 list_threads。
6. 你不能删除线程或话题；用户要求删除时，让他在界面上确认。
7. 所有线程共享同一对话上下文：你在任何线程里讨论过的内容都仍然有效，不要声称“看不到之前的对话”。

操作规则：优先使用 call_mac_manager_api 操作本应用能力（127.0.0.1）。写操作返回 202 只表示任务已被接收，必须再用 GET /api/tasks 核实结果，不能当成已完成。危险动作（杀进程、删文件、重启服务、覆盖配置）必须先说明目标与影响，得到用户明确确认后才执行。写操作不自动重试；请求中断标“结果未知”；敏感信息不写入日志。`

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
