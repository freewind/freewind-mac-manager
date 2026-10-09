import { z } from "zod"

export const ApiErrorSchema = z.object({
  message: z.string(),
})

export const ActionResponseSchema = z.object({
  message: z.string(),
})

export const KillProcessesBodySchema = z.object({
  pids: z.array(z.number().int().positive().max(999999)).min(1).max(64),
  force: z.boolean().optional(),
})

export const KillResultSchema = z.object({
  pid: z.number().int(),
  succeeded: z.boolean(),
  message: z.string(),
})

export const KillProcessesResponseSchema = z.object({
  results: z.array(KillResultSchema),
})
