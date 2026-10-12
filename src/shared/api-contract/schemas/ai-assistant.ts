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
