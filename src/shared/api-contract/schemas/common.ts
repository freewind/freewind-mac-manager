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

/**
 * 写操作的请求标识由客户端生成，服务端据此复用任务、避免重复执行。
 * 只允许 URL 安全字符，便于放进 header 与查询参数。
 */
export const TASK_REQUEST_ID_HEADER = "x-task-request-id" as const

export const TaskRequestIdSchema = z
  .string()
  .min(16)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "请求标识只能包含字母、数字、下划线和连字符")

export const TaskRequestIdHeadersSchema = z.object({
  [TASK_REQUEST_ID_HEADER]: TaskRequestIdSchema,
})

/**
 * 写操作超过响应阈值而未完成时的受理回执：只说明任务已接收与在哪查询，
 * 不代表动作已完成。
 */
export const TaskAcceptedSchema = z.object({
  taskId: z.string().min(1),
  kind: z.string().min(1),
  status: z.literal("running"),
  startedAt: z.number(),
})
