import { z } from "zod"
import { ScanTaskResultSchema } from "./disk-growth"
import { FileBatchResultSchema } from "./files"

/**
 * 任务进度必须来自真实处理事件：done/bytesDone 是已经确认完成的数量，
 * total/bytesTotal 在无法预先知道时为 null，前端不得据此伪造百分比。
 */
export const TaskProgressSchema = z.object({
  done: z.number().int().min(0),
  total: z.number().int().min(0).nullable(),
  bytesDone: z.number().min(0).nullable(),
  bytesTotal: z.number().min(0).nullable(),
  /** 当前阶段的简短描述，例如「统计文件」「复制中」。 */
  stage: z.string(),
  /** 最后处理的目标路径或进程；可空。 */
  currentTarget: z.string().nullable(),
})

/**
 * running：仍在执行；done：全部完成；partial：部分完成（有失败或跳过项）；
 * failed：未完成且没有可用结果；unknown：无法核实（服务中断、结果丢失）。
 */
export const TaskStatusSchema = z.enum([
  "running",
  "done",
  "partial",
  "failed",
  "unknown",
])

const taskBase = {
  id: z.string().min(1),
  /** 客户端请求标识；执行前登记，断网后据此核实。为 NULL 表示不是由客户端请求发起（如每日定时扫描）。 */
  requestId: z.string().nullable(),
  /** 任务作用域，用于同目标冲突判断；形式由各域决定。 */
  target: z.string(),
  status: TaskStatusSchema,
  progress: TaskProgressSchema.nullable(),
  /** 完成或部分完成时的可读说明。 */
  message: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  /** 最近一次进度更新时间，用于判断数据新鲜度。 */
  updatedAt: z.number(),
}

export const DiskScanTaskSchema = z.object({
  ...taskBase,
  kind: z.literal("disk_scan"),
  result: ScanTaskResultSchema.nullable(),
})

export const FileCopyTaskSchema = z.object({
  ...taskBase,
  kind: z.literal("file_copy"),
  result: FileBatchResultSchema.nullable(),
})

export const FileDeleteTaskSchema = z.object({
  ...taskBase,
  kind: z.literal("file_delete"),
  result: FileBatchResultSchema.nullable(),
})

export const FileMoveTaskSchema = z.object({
  ...taskBase,
  kind: z.literal("file_move"),
  result: FileBatchResultSchema.nullable(),
})

/** 每种任务的结果结构由 discriminated union 固定，禁止用任意 JSON 承载结果。 */
export const TaskRecordSchema = z.discriminatedUnion("kind", [
  DiskScanTaskSchema,
  FileCopyTaskSchema,
  FileDeleteTaskSchema,
  FileMoveTaskSchema,
])

export type TaskRecord = z.infer<typeof TaskRecordSchema>
export type TaskKind = TaskRecord["kind"]

/** active 只看未终结任务；all 兼顾近期已终结任务，供恢复时核实。 */
export const TaskListQuerySchema = z.object({
  requestId: z.string().min(1).max(64).optional(),
  status: z.enum(["active", "all"]).default("active"),
  /** 逗号分隔的任务种类过滤。 */
  kinds: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const TaskListResponseSchema = z.object({
  tasks: z.array(TaskRecordSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
})

export const TaskIdPathParamsSchema = z.object({
  id: z.string().min(1),
})
