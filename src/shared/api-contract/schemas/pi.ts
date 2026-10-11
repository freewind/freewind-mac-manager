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
  modelCount: z.number().int().nonnegative(),
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
