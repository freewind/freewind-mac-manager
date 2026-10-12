import { z } from "zod"

export const AI_ASSISTANT_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const

/** 内置工具白名单：与会话实现的工具能力保持一致。 */
export const AI_ASSISTANT_DEFAULT_TOOLS = [
  "read",
  "bash",
  "write",
  "edit",
  "grep",
  "ls",
] as const

export const AiAssistantSettingsSchema = z.object({
  providerId: z.string().min(1).max(256).optional(),
  modelId: z.string().min(1).max(256).optional(),
  thinkingLevel: z.enum(AI_ASSISTANT_THINKING_LEVELS).optional(),
  systemPrompt: z.string().max(8000).optional(),
  enabledTools: z.array(z.string().min(1).max(64)).optional(),
})

export const AiAssistantSettingsResponseSchema = z.object({
  settings: AiAssistantSettingsSchema,
  signature: z.string().length(64),
  updatedAt: z.number(),
  defaults: z.object({
    systemPrompt: z.string(),
    enabledTools: z.array(z.string()),
  }),
})

export const AiAssistantSettingsMutationSchema = z.object({
  signature: z.string().length(64),
  settings: AiAssistantSettingsSchema,
  clearFields: z
    .array(
      z.enum([
        "providerId",
        "modelId",
        "thinkingLevel",
        "systemPrompt",
        "enabledTools",
      ])
    )
    .default([]),
})

export const AiAssistantSessionSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  status: z.enum(["idle", "running", "done", "unknown"]),
  messageCount: z.number().int().nonnegative(),
})

export const AiAssistantSessionListSchema = z.object({
  sessions: z.array(AiAssistantSessionSchema),
})

export const AiAssistantSessionPathSchema = z.object({
  sessionId: z.string().min(1).max(256),
})

export const AiAssistantMessageRequestSchema = z.object({
  sessionId: z.string().min(1).max(256).optional(),
  prompt: z.string().min(1).max(10_000),
})

/**
 * 执行状态：running 表示还在跑；done 表示有确定结果；
 * unknown 表示结果无法确认（出错、显式停止或会话被丢弃）。
 */
export const AiAssistantExecutionStatusSchema = z.enum([
  "running",
  "done",
  "unknown",
])

/**
 * 一次执行的状态。执行归服务端，与浏览器连接无关：断线后仍可按 id 查询。
 * cancelled 区分「受控中止」与「执行出错」——两者状态都是 unknown。
 */
export const AiAssistantExecutionSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  status: AiAssistantExecutionStatusSchema,
  cancelled: z.boolean(),
  prompt: z.string(),
  answer: z.string().nullable(),
  message: z.string().nullable(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  /** 当前可重放的事件条数；超长执行只保证最近一段。 */
  eventCount: z.number().int().nonnegative(),
})

/** 会话历史里的一条消息。 */
export const AiAssistantHistoryMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
})

export const AiAssistantExecutionResponseSchema = z.object({
  execution: AiAssistantExecutionSchema,
  /** 该执行所属会话的历史：重新连上时一并取回进度与已落盘的回答。 */
  messages: z.array(AiAssistantHistoryMessageSchema),
})

export const AiAssistantExecutionPathSchema = z.object({
  executionId: z.string().min(1).max(256),
})
