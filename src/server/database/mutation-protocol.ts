import {
  DATABASE_DELETE_MAX,
  DatabaseDeleteItemSchema,
  DatabaseIdentifierSchema,
  DatabaseRecordLocatorKeySchema,
  DatabaseRecordSignatureSchema,
  SqliteWritableValueSchema,
} from "@shared/api-contract"
import { z } from "zod"
import { DatabaseQueryFailedMessageSchema } from "./query-protocol"

/**
 * 父进程与写子进程之间共享的协议与错误类型。
 *
 * 任务里只有受校验的写结构，没有 SQL 文本字段；worker 侧再按真实元信息核验
 * 表名、列名与主键，外部输入无法指定要执行什么语句。
 */

/**
 * not_started：确定没有提交（业务拒绝、约束冲突、排队拒绝）；
 * failed：执行过但确定失败；
 * unknown：超时或进程异常，无法确认是否已提交，必须靠后续读取核实，禁止自动重发。
 */
export const MUTATION_EXECUTION_STATUSES = [
  "not_started",
  "failed",
  "unknown",
] as const

export type MutationExecutionStatus =
  (typeof MUTATION_EXECUTION_STATUSES)[number]

export class DatabaseMutationError extends Error {
  constructor(
    readonly httpStatus: 400 | 403 | 404 | 409 | 429 | 500,
    message: string,
    /** 默认确定没有提交；只有事务状态无法确认时才标 unknown。 */
    readonly executionStatus: MutationExecutionStatus = "not_started"
  ) {
    super(message)
    this.name = "DatabaseMutationError"
  }
}

export const MutationJobSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("insert"),
    table: DatabaseIdentifierSchema,
    /** 省略的列交给数据库默认值；空对象表示 DEFAULT VALUES。 */
    values: z.record(DatabaseIdentifierSchema, SqliteWritableValueSchema),
  }),
  z.object({
    kind: z.literal("update"),
    table: DatabaseIdentifierSchema,
    key: DatabaseRecordLocatorKeySchema,
    expectedSignature: DatabaseRecordSignatureSchema,
    values: z.record(DatabaseIdentifierSchema, SqliteWritableValueSchema),
  }),
  z.object({
    kind: z.literal("delete"),
    table: DatabaseIdentifierSchema,
    items: z.array(DatabaseDeleteItemSchema).min(1).max(DATABASE_DELETE_MAX),
  }),
])

export type MutationJob = z.infer<typeof MutationJobSchema>

export type MutationJobKind = MutationJob["kind"]

export const MutationResultMessageSchema = z.object({
  type: z.literal("result"),
  result: z.unknown(),
})

export const MutationFailedMessageSchema = z.object({
  type: z.literal("failed"),
  error: z.string().min(1),
  httpStatus: DatabaseQueryFailedMessageSchema.shape.httpStatus,
  executionStatus: z.enum(MUTATION_EXECUTION_STATUSES),
})

export const MutationMessageSchema = z.discriminatedUnion("type", [
  MutationResultMessageSchema,
  MutationFailedMessageSchema,
])

export type MutationMessage = z.infer<typeof MutationMessageSchema>

export const serializeMutationMessage = (message: MutationMessage): string =>
  `${JSON.stringify(message)}\n`

/** 解析子进程的一行消息；格式不符返回 null，由调用方按协议错误处理。 */
export const parseMutationMessage = (line: string): MutationMessage | null => {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null
  try {
    const parsed = MutationMessageSchema.safeParse(JSON.parse(trimmed))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
