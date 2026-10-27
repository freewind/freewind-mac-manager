import { z } from "zod"

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
)

export const PiModelSchema = z
  .object({
    id: z.string().min(1).max(256),
    name: z.string().max(256).optional(),
    reasoning: z.boolean().optional(),
    input: z.array(z.enum(["text", "image"])).optional(),
    contextWindow: z.number().int().positive().max(10_000_000).optional(),
    maxTokens: z.number().int().positive().max(10_000_000).optional(),
    thinkingLevelMap: z.record(z.string(), z.string().nullable()).optional(),
  })
  .catchall(JsonValueSchema)

export const PiProviderSchema = z
  .object({
    name: z.string().min(1).max(256).optional(),
    baseUrl: z.string().url().max(2048),
    api: z.string().min(1).max(128),
    models: z.array(PiModelSchema).max(256),
    authHeader: z.boolean().optional(),
    compat: z.record(z.string(), JsonValueSchema).optional(),
  })
  .catchall(JsonValueSchema)

export const PiProviderEntrySchema = z.object({
  id: z.string(),
  provider: PiProviderSchema,
  hasApiKey: z.boolean(),
  /** 列表里只给掩码，不返回明文密钥。 */
  apiKeyPreview: z.string().optional(),
  modelCount: z.number().int().nonnegative(),
})

export const PiProviderApiKeySchema = z.object({
  apiKey: z.string().nullable(),
})

export const PiModelsResponseSchema = z.object({
  providers: z.array(PiProviderEntrySchema),
  signature: z.string(),
  updatedAt: z.number(),
})

export const PiProviderInputSchema = z
  .object({
    name: z.string().min(1).max(256),
    baseUrl: z.string().url().max(2048),
    api: z.string().min(1).max(128),
    apiKey: z.string().max(8192).optional(),
    models: z.array(PiModelSchema).min(1).max(256),
    authHeader: z.boolean().optional(),
    compat: z.record(z.string(), JsonValueSchema).optional(),
  })
  .catchall(JsonValueSchema)

export const PiProviderMutationSchema = z.object({
  providerId: z.string().min(1).max(256),
  signature: z.string().length(64),
  clearApiKey: z.boolean().optional(),
  provider: PiProviderInputSchema,
})

export const PiProviderIdSchema = z.object({
  providerId: z.string().min(1).max(256),
})

export const PiProviderDeleteSchema = z.object({
  signature: z.string().length(64),
})

export const PiProviderDeleteBodySchema = z.object({
  signature: z.string().length(64),
})

export const PiProviderWriteResultSchema = z.object({
  providerId: z.string(),
  hasApiKey: z.boolean(),
})

export const PiSettingsDocumentSchema = z
  .object({
    defaultProvider: z.string().optional(),
    defaultModel: z.string().optional(),
    defaultThinkingLevel: z
      .enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
      .optional(),
    theme: z.string().optional(),
    retry: z
      .object({
        enabled: z.boolean().optional(),
        maxRetries: z.number().int().min(0).max(20).optional(),
        baseDelayMs: z.number().int().min(0).max(300_000).optional(),
      })
      .optional(),
    compaction: z
      .object({
        enabled: z.boolean().optional(),
        reserveTokens: z.number().int().min(0).max(1_000_000).optional(),
        keepRecentTokens: z.number().int().min(0).max(1_000_000).optional(),
      })
      .optional(),
  })
  .catchall(JsonValueSchema)

export const PiSettingsResponseSchema = z.object({
  settings: PiSettingsDocumentSchema,
  signature: z.string(),
  updatedAt: z.number(),
  defaults: z.object({
    defaultThinkingLevel: z.string(),
    theme: z.string(),
    retry: z.object({
      enabled: z.boolean(),
      maxRetries: z.number(),
      baseDelayMs: z.number(),
    }),
    compaction: z.object({
      enabled: z.boolean(),
      reserveTokens: z.number(),
      keepRecentTokens: z.number(),
    }),
  }),
})

export const PiBenchmarkRequestSchema = z.object({
  providerId: z.string().min(1).max(256),
  modelId: z.string().min(1).max(256),
  thinkingLevel: z
    .enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
    .default("medium"),
  timeoutMs: z.number().int().min(1000).max(60_000).default(30_000),
  prompt: z.string().min(1).max(4096).default("请简短回答：1 + 1 等于多少？"),
})

export const PiBenchmarkTaskPayloadSchema = PiBenchmarkRequestSchema.extend({
  requestId: z
    .string()
    .min(16)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
  maxTokens: z.number().int().positive().max(10_000_000),
}).strict()

export const PiBenchmarkStartSchema = z.object({
  taskId: z.string().min(1),
  kind: z.literal("pi_benchmark"),
  status: z.literal("running"),
  startedAt: z.number(),
})

export const PiBenchmarkErrorSchema = z.object({
  message: z.string(),
  executionStatus: z.enum(["not_started", "failed", "unknown"]).optional(),
  requestId: z
    .string()
    .min(16)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
})

export const PiBenchmarkMetricsSchema = z.object({
  firstEventMs: z.number().nonnegative().nullable(),
  firstTextMs: z.number().nonnegative().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  textOutputTokens: z.number().int().nonnegative().nullable(),
  cacheReadTokens: z.number().int().nonnegative().nullable(),
  cacheWriteTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  outputTokensPerSecond: z.number().nonnegative().nullable(),
  thinkingTokens: z.number().int().nonnegative().nullable(),
})

export const PiBenchmarkResultSchema = z.object({
  message: z.string().max(160),
  id: z.string().min(16).max(64),
  requestId: z
    .string()
    .min(16)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
  providerId: z.string(),
  modelId: z.string(),
  thinkingLevel: z.string(),
  configuredMaxTokens: z.number().int().positive(),
  status: z.enum(["running", "done", "partial", "failed", "unknown"]),
  metrics: PiBenchmarkMetricsSchema,
  stopReason: z.string().nullable(),
  error: z
    .enum(["timeout", "cancelled", "provider_error", "output_limit"])
    .nullable(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  source: z.literal("pi-sdk"),
})

export const PiBenchmarkListSchema = z.object({
  benchmarks: z.array(PiBenchmarkResultSchema).max(100),
})

export const PiBenchmarkDeleteSchema = z.object({
  ids: z.array(z.string().min(16).max(64)).min(1).max(50),
})

export const PiSettingsMutationSchema = z
  .object({
    signature: z.string().length(64),
    modelsSignature: z.string().length(64),
    settings: PiSettingsDocumentSchema,
    clearFields: z
      .array(
        z.enum([
          "defaultProvider",
          "defaultModel",
          "defaultThinkingLevel",
          "theme",
          "retry",
          "compaction",
        ])
      )
      .default([]),
    clearSubfields: z
      .array(
        z.enum([
          "defaultThinkingLevel",
          "theme",
          "retry.enabled",
          "retry.maxRetries",
          "retry.baseDelayMs",
          "compaction.enabled",
          "compaction.reserveTokens",
          "compaction.keepRecentTokens",
        ])
      )
      .default([]),
  })
  .catchall(JsonValueSchema)
