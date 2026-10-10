import { TaskProgressSchema } from "@shared/api-contract"
import { z } from "zod"

/**
 * 父子进程之间只传这几条受校验的消息。
 *
 * 任务类型必须在子进程的固定注册表里查表，载荷里不允许出现模块路径、命令名或
 * shell 片段，因此外部输入无法指定要加载的代码或要执行的命令。
 */
export const WorkerJobSchema = z.object({
  taskId: z.string().min(1),
  kind: z.string().min(1),
  target: z.string(),
  requestId: z.string().nullable(),
  payload: z.unknown(),
})

export type WorkerJob = z.infer<typeof WorkerJobSchema>

export const WorkerProgressMessageSchema = z.object({
  type: z.literal("progress"),
  progress: TaskProgressSchema,
})

export const WorkerResultMessageSchema = z.object({
  type: z.literal("result"),
  result: z.unknown(),
  message: z.string().nullable(),
  status: z.enum(["done", "partial"]),
})

export const WorkerFailedMessageSchema = z.object({
  type: z.literal("failed"),
  error: z.string(),
})

export const WorkerMessageSchema = z.discriminatedUnion("type", [
  WorkerProgressMessageSchema,
  WorkerResultMessageSchema,
  WorkerFailedMessageSchema,
])

export type WorkerMessage = z.infer<typeof WorkerMessageSchema>

export const serializeWorkerMessage = (message: WorkerMessage): string =>
  `${JSON.stringify(message)}\n`

/** 解析一行协议消息；格式不符返回 null，由调用方按协议错误处理。 */
export const parseWorkerMessage = (line: string): WorkerMessage | null => {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  const result = WorkerMessageSchema.safeParse(parsed)
  return result.success ? result.data : null
}

export const parseWorkerJob = (line: string): WorkerJob | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  const result = WorkerJobSchema.safeParse(parsed)
  return result.success ? result.data : null
}
