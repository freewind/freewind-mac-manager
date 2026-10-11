import { z } from "zod"

/** 模型分组成员：指向 models.json 中真实存在的 provider 与模型。 */
export const PiModelGroupMemberSchema = z.object({
  provider: z.string().min(1).max(256),
  modelId: z.string().min(1).max(256),
})

export const PiModelGroupMemberInputSchema = z.object({
  provider: z.string().min(1).max(256),
  modelId: z.string().min(1).max(256),
})

/** 单个模型分组；id 由外层对象键决定，条目内不再重复。 */
export const PiModelGroupSchema = z.object({
  name: z.string().min(1).max(256),
  contextWindow: z.number().int().positive().max(10_000_000).optional(),
  maxTokens: z.number().int().positive().max(10_000_000).optional(),
  members: z.array(PiModelGroupMemberSchema).min(1).max(256),
})

export const PiModelGroupsResponseSchema = z.object({
  groups: z.array(
    z.object({
      id: z.string(),
      group: PiModelGroupSchema,
    })
  ),
  signature: z.string(),
  updatedAt: z.number(),
})

export const PiModelGroupInputSchema = z.object({
  name: z.string().min(1).max(256),
  contextWindow: z.number().int().positive().max(10_000_000).optional(),
  maxTokens: z.number().int().positive().max(10_000_000).optional(),
  members: z.array(PiModelGroupMemberInputSchema).min(1).max(256),
})

export const PiModelGroupAddSchema = z.object({
  groupId: z.string().min(1).max(256),
  signature: z.string().length(64),
  group: PiModelGroupInputSchema,
})

export const PiModelGroupIdSchema = z.object({
  groupId: z.string().min(1).max(256),
})

export const PiModelGroupReplaceSchema = z.object({
  signature: z.string().length(64),
  group: PiModelGroupInputSchema,
})

export const PiModelGroupDeleteSchema = z.object({
  signature: z.string().length(64),
})

export const PiModelGroupWriteResultSchema = z.object({
  groupId: z.string(),
})
