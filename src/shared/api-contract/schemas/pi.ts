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
