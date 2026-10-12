import {
  DatabaseIdentifierSchema,
  DatabaseRecordLocatorKeySchema,
  DatabaseRecordsQuerySchema,
} from "@shared/api-contract"
import { z } from "zod"

/**
 * 父进程与查询子进程之间共享的协议与错误类型。
 *
 * 任务里只允许出现受校验的查询结构，没有 SQL 文本字段：worker 侧再按真实
 * 元信息核验表名与列名，外部输入无法指定要执行什么语句。
 */

/** 查询失败按 HTTP 语义带上状态码，由后续 handler 直接映射，不再二次猜测。 */
export const DATABASE_QUERY_ERROR_STATUSES = [
  400, 403, 404, 409, 429, 500,
] as const

export type DatabaseQueryErrorStatus =
  (typeof DATABASE_QUERY_ERROR_STATUSES)[number]

export class DatabaseQueryError extends Error {
  constructor(
    readonly httpStatus: DatabaseQueryErrorStatus,
    message: string
  ) {
    super(message)
    this.name = "DatabaseQueryError"
  }
}

export const DatabaseQueryJobSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("list_tables") }),
  z.object({
    kind: z.literal("table_detail"),
    table: DatabaseIdentifierSchema,
  }),
  z.object({
    kind: z.literal("list_records"),
    table: DatabaseIdentifierSchema,
    query: DatabaseRecordsQuerySchema,
  }),
  z.object({
    kind: z.literal("get_record"),
    table: DatabaseIdentifierSchema,
    key: DatabaseRecordLocatorKeySchema,
  }),
])

export type DatabaseQueryJob = z.infer<typeof DatabaseQueryJobSchema>

export type DatabaseQueryJobKind = DatabaseQueryJob["kind"]

export const DatabaseQueryResultMessageSchema = z.object({
  type: z.literal("result"),
  result: z.unknown(),
})

export const DatabaseQueryFailedMessageSchema = z.object({
  type: z.literal("failed"),
  error: z.string().min(1),
  httpStatus: z.union([
    z.literal(400),
    z.literal(403),
    z.literal(404),
    z.literal(409),
    z.literal(429),
    z.literal(500),
  ]),
})

export const DatabaseQueryMessageSchema = z.discriminatedUnion("type", [
  DatabaseQueryResultMessageSchema,
  DatabaseQueryFailedMessageSchema,
])

export type DatabaseQueryMessage = z.infer<typeof DatabaseQueryMessageSchema>

export const serializeDatabaseQueryMessage = (
  message: DatabaseQueryMessage
): string => `${JSON.stringify(message)}\n`

/** 解析子进程的一行消息；格式不符返回 null，由调用方按协议错误处理。 */
export const parseDatabaseQueryMessage = (
  line: string
): DatabaseQueryMessage | null => {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null
  try {
    const parsed = DatabaseQueryMessageSchema.safeParse(JSON.parse(trimmed))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
