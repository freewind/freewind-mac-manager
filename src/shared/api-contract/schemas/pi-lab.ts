import { z } from "zod"
import { TaskRequestIdSchema } from "./common"

export const PiThinkingSchema = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
])
export const PiLabRequestSchema = z
  .object({
    providerId: z.string().min(1).max(256),
    modelId: z.string().min(1).max(256),
    mode: z.literal("probe"),
    sessionId: z.string().uuid().optional(),
    prompt: z.string().min(1).max(8000),
    systemPrompt: z.string().max(4000).default("你是一个简洁的对话助手。"),
    thinking: PiThinkingSchema.default("off"),
    maxTokens: z.number().int().min(16).max(4096).default(512),
    tokenCandidates: z
      .array(z.number().int().min(16).max(4096))
      .min(1)
      .max(4)
      .default([128, 512]),
    thinkingCandidates: z
      .array(PiThinkingSchema)
      .min(1)
      .max(4)
      .default(["off", "high"]),
  })
  .strict()
export const PiLabPayloadSchema = PiLabRequestSchema.extend({
  requestId: TaskRequestIdSchema,
})
export const PiLabPathSchema = z.object({ id: TaskRequestIdSchema })
export const PiLabSampleSchema = z.object({
  requestedThinking: PiThinkingSchema,
  requestedMaxTokens: z.number(),
  sentParameters: z.string().nullable(),
  status: z.enum(["accepted", "rejected", "unknown"]),
  stopReason: z.string().nullable(),
  outputTokens: z.number().nullable(),
})
export const PiLabResultSchema = z.object({
  id: TaskRequestIdSchema,
  sessionId: z.string().uuid().nullable(),
  providerId: z.string(),
  modelId: z.string(),
  mode: z.enum(["chat", "probe"]),
  status: z.enum(["running", "done", "partial", "failed", "unknown"]),
  message: z.string(),
  text: z.string(),
  thinking: z.string(),
  input: z.string(),
  payload: z.string().nullable(),
  samples: z.array(PiLabSampleSchema),
  updatedAt: z.number(),
})
export const PiLabListSchema = z.object({ runs: z.array(PiLabResultSchema) })
export const PiLabClearSchema = z.object({ sessionId: z.string().uuid() })
export type PiLabInput = z.input<typeof PiLabRequestSchema>
export type PiLabPayload = z.infer<typeof PiLabPayloadSchema>
export type PiLabResult = z.infer<typeof PiLabResultSchema>
