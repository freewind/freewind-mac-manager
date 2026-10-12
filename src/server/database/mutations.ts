import type { DatabaseSync } from "node:sqlite"
import type {
  DatabaseDeleteResult,
  DatabaseRecordLocatorKey,
  DatabaseRecordResponse,
  SqliteValue,
  SqliteWritableValue,
} from "@shared/api-contract"
import {
  DATABASE_DELETE_MAX,
  DATABASE_TEXT_MAX_LENGTH,
} from "@shared/api-contract"
import { type ColumnMeta, requireTable, type TableMeta } from "./metadata"
import { DatabaseMutationError } from "./mutation-protocol"
import {
  primaryKeyColumnsOf,
  QUERY_RESPONSE_MAX_BYTES,
  quoteIdentifier,
  selectColumnsOf,
  toRecord,
} from "./query"
import { DatabaseQueryError } from "./query-protocol"
import { decodeSqliteValue, type SqliteBindValue } from "./values"

/**
 * 事务化的通用增删改：每次写都重新核验真实表、列、主键与操作能力，
 * 全程一个 BEGIN IMMEDIATE 事务，靠完整主键加整行签名定位与并发校验，
 * 不存在任何整表操作或任意 SQL 的入口。
 */

/** 一次删除的上限，与契约里的 DATABASE_DELETE_MAX 同源。 */
export const MUTATION_DELETE_MAX = DATABASE_DELETE_MAX

const OPERATION_LABELS = {
  insert: "新增",
  update: "修改",
  delete: "删除",
} as const

/** SQLite 扩展错误码到可读说明；只描述约束种类，不带任何数据。 */
const CONSTRAINT_MESSAGES: Record<number, string> = {
  1555: "违反主键约束",
  2067: "违反唯一约束",
  1299: "违反非空约束",
  275: "违反 CHECK 约束",
  787: "违反外键约束",
  1811: "触发器拒绝了写入",
}

type Row = Record<string, unknown>

type SqliteErrorShape = {
  code?: unknown
  errcode?: unknown
  message?: unknown
}

const describeError = (
  error: unknown
): { primary: number; extended: number; message: string; code: string } => {
  const shape = (
    typeof error === "object" && error !== null ? error : {}
  ) as SqliteErrorShape
  const extended = typeof shape.errcode === "number" ? shape.errcode : 0
  return {
    extended,
    primary: extended & 0xff,
    message: typeof shape.message === "string" ? shape.message : "",
    code: typeof shape.code === "string" ? shape.code : "",
  }
}

/**
 * 约束错误只保留「表.列」这类结构信息，绝不复用可能带文案的触发器消息，
 * 也不把原值或内部 SQL 回传给客户端。
 */
const constraintDetail = (extended: number, message: string): string => {
  if (extended === 1811) return ""
  const match = /failed: (.+)$/.exec(message)
  return match ? `（${match[1].slice(0, 120)}）` : ""
}

/** 把数据库异常按语义归类：约束冲突与繁忙 409、非法输入 400、权限 403、未预期 500。 */
export const classifyDatabaseError = (
  error: unknown
): DatabaseMutationError => {
  const { primary, extended, message, code } = describeError(error)
  if (code === "ERR_INVALID_ARG_TYPE") {
    return new DatabaseMutationError(400, "写入参数不合法")
  }
  if (primary === 19) {
    const label = CONSTRAINT_MESSAGES[extended] ?? "违反数据库约束"
    return new DatabaseMutationError(
      409,
      `${label}${constraintDetail(extended, message)}`
    )
  }
  switch (primary) {
    case 5:
    case 6:
      return new DatabaseMutationError(409, "数据库正忙，请稍后重试")
    case 3:
    case 8:
    case 23:
      return new DatabaseMutationError(403, "数据库拒绝写入")
    case 18:
    case 20:
    case 25:
      return new DatabaseMutationError(400, "写入参数不合法")
    case 1:
      // 表或列在核验之后被改掉了：这是状态冲突，不是客户端参数错误
      return new DatabaseMutationError(
        409,
        "数据库结构已变化，请重新读取后再操作"
      )
    default:
      return new DatabaseMutationError(500, "写入失败")
  }
}

const guarded = <T>(run: () => T): T => {
  try {
    return run()
  } catch (error) {
    if (error instanceof DatabaseMutationError) throw error
    if (error instanceof DatabaseQueryError) {
      throw new DatabaseMutationError(error.httpStatus, error.message)
    }
    throw classifyDatabaseError(error)
  }
}

const rollback = (database: DatabaseSync): void => {
  try {
    database.exec("ROLLBACK")
  } catch {
    // 回滚都失败就无法保证没有部分提交，必须按结果未知上报
    throw new DatabaseMutationError(
      500,
      "写入失败且事务未能回滚，结果未知，请重新读取确认",
      "unknown"
    )
  }
}

/**
 * BEGIN IMMEDIATE 立刻拿写锁：锁等待集中在事务开始处，避免读后升级写时死锁；
 * 任何异常都回滚，绝不留下半个事务。
 */
const withWriteTransaction = <T>(database: DatabaseSync, run: () => T): T => {
  database.exec("BEGIN IMMEDIATE")
  let result: T
  try {
    result = run()
  } catch (error) {
    rollback(database)
    throw error
  }
  try {
    database.exec("COMMIT")
  } catch (error) {
    rollback(database)
    throw classifyDatabaseError(error)
  }
  return result
}

const requireWritable = (
  meta: TableMeta,
  operation: keyof typeof OPERATION_LABELS
): void => {
  const capability = meta.capabilities.find(
    (item) => item.operation === operation
  )
  if (!capability?.allowed) {
    const reason = capability?.allowed === false ? capability.message : "不可写"
    throw new DatabaseMutationError(
      403,
      `表「${meta.name}」不能${OPERATION_LABELS[operation]}：${reason}`
    )
  }
}

const requireReliablePrimaryKey = (
  meta: TableMeta,
  action: string
): ColumnMeta[] => {
  const columns = primaryKeyColumnsOf(meta)
  if (!meta.reliablePrimaryKey || columns.length === 0) {
    throw new DatabaseMutationError(
      403,
      `表「${meta.name}」没有可靠主键，不能${action}`
    )
  }
  return columns
}

const columnOf = (meta: TableMeta, name: string): ColumnMeta => {
  const column = meta.columns.find((item) => item.name === name)
  if (!column) {
    throw new DatabaseMutationError(400, `列「${name}」不存在`)
  }
  return column
}

const assertValueSize = (name: string, value: SqliteWritableValue): void => {
  if (value.type !== "text") return
  const bytes = Buffer.byteLength(value.value, "utf8")
  if (bytes > DATABASE_TEXT_MAX_LENGTH) {
    throw new DatabaseMutationError(
      400,
      `列「${name}」的文本 ${bytes} 字节超过单值上限 ${DATABASE_TEXT_MAX_LENGTH} 字节`
    )
  }
}

/**
 * 写入列校验：生成列、隐藏列、BLOB 一律不能写；修改时连主键列也不能写，
 * 主键是定位条件，改它等于换一行。
 */
const assertWritableColumns = (
  meta: TableMeta,
  values: Record<string, SqliteWritableValue>,
  options: { allowPrimaryKey: boolean }
): void => {
  for (const [name, value] of Object.entries(values)) {
    const column = columnOf(meta, name)
    if (column.generated) {
      throw new DatabaseMutationError(
        400,
        `生成列「${name}」由数据库计算，不能写入`
      )
    }
    if (column.hidden) {
      throw new DatabaseMutationError(400, `隐藏列「${name}」不能写入`)
    }
    if (column.affinity === "blob" || isBlobValue(value)) {
      throw new DatabaseMutationError(400, `BLOB 列「${name}」首期只读`)
    }
    if (!options.allowPrimaryKey && column.primaryKeyPosition > 0) {
      throw new DatabaseMutationError(400, `主键列「${name}」不能修改`)
    }
    assertValueSize(name, value)
  }
}

/** 契约的写入侧没有 blob，这里再挡一次，避免绕过校验直接调用时写进去。 */
const isBlobValue = (value: SqliteWritableValue): boolean =>
  (value as { type: string }).type === "blob"

type ResolvedKey = Array<{ column: ColumnMeta; value: SqliteValue }>

/** 主键必须恰好覆盖表的主键列且不重复，缺一个就会退化成范围操作。 */
const resolveKey = (
  primaryKeyColumns: ColumnMeta[],
  key: DatabaseRecordLocatorKey
): ResolvedKey => {
  const given = new Map<string, SqliteValue>()
  for (const part of key) {
    if (given.has(part.column)) {
      throw new DatabaseMutationError(400, `主键列「${part.column}」重复给出`)
    }
    if (!primaryKeyColumns.some((column) => column.name === part.column)) {
      throw new DatabaseMutationError(400, `「${part.column}」不是主键列`)
    }
    given.set(part.column, part.value)
  }
  return primaryKeyColumns.map((column) => {
    const value = given.get(column.name)
    if (value === undefined) {
      throw new DatabaseMutationError(
        400,
        `主键必须完整给出：${primaryKeyColumns
          .map((item) => item.name)
          .join(", ")}`
      )
    }
    return { column, value }
  })
}

/** 定位条件只能由主键拼出；空条件一律拒绝，避免整表操作。 */
const whereOf = (key: ResolvedKey): string => {
  if (key.length === 0) {
    throw new DatabaseMutationError(500, "拒绝执行没有定位条件的写入")
  }
  return key
    .map((part) => `${quoteIdentifier(part.column.name)} = ?`)
    .join(" AND ")
}

const paramsOf = (key: ResolvedKey): SqliteBindValue[] =>
  key.map((part) => decodeSqliteValue(part.value))

const returningOf = (meta: TableMeta): string =>
  selectColumnsOf(meta)
    .map((column) => quoteIdentifier(column.name))
    .join(", ")

const readRow = (
  database: DatabaseSync,
  meta: TableMeta,
  key: ResolvedKey
): Row | undefined =>
  database
    .prepare(
      `SELECT ${returningOf(meta)} FROM ${quoteIdentifier(meta.name)} WHERE ${whereOf(key)} LIMIT 1`
    )
    .get(...paramsOf(key)) as Row | undefined

/** 响应上限在提交前检查：超了就回滚，不留下已经写进去却报错的结果。 */
const assertResponseSize = (response: unknown): void => {
  if (
    Buffer.byteLength(JSON.stringify(response), "utf8") >
    QUERY_RESPONSE_MAX_BYTES
  ) {
    throw new DatabaseMutationError(
      400,
      `结果超过 ${QUERY_RESPONSE_MAX_BYTES / (1024 * 1024)}MiB，请减少一次写入的列数`
    )
  }
}

export type InsertRecordInput = {
  table: string
  values: Record<string, SqliteWritableValue>
}

export const insertRecord = (
  database: DatabaseSync,
  input: InsertRecordInput
): DatabaseRecordResponse =>
  guarded(() =>
    withWriteTransaction(database, () => {
      const meta = requireTable(database, input.table)
      requireWritable(meta, "insert")
      const primaryKeyColumns = requireReliablePrimaryKey(meta, "回读新增记录")
      assertWritableColumns(meta, input.values, { allowPrimaryKey: true })

      const names = Object.keys(input.values)
      const sql =
        names.length === 0
          ? `INSERT INTO ${quoteIdentifier(meta.name)} DEFAULT VALUES RETURNING ${returningOf(meta)}`
          : `INSERT INTO ${quoteIdentifier(meta.name)} (${names
              .map(quoteIdentifier)
              .join(", ")}) VALUES (${names
              .map(() => "?")
              .join(", ")}) RETURNING ${returningOf(meta)}`
      const rows = database
        .prepare(sql)
        .all(
          ...names.map((name) => decodeSqliteValue(input.values[name]))
        ) as Row[]
      const row = rows[0]
      if (!row) {
        throw new DatabaseMutationError(500, "新增后没有回读到记录")
      }
      const response: DatabaseRecordResponse = {
        table: meta.name,
        record: toRecord(selectColumnsOf(meta), primaryKeyColumns, row),
      }
      assertResponseSize(response)
      return response
    })
  )

export type UpdateRecordInput = {
  table: string
  key: DatabaseRecordLocatorKey
  expectedSignature: string
  values: Record<string, SqliteWritableValue>
}

export const updateRecord = (
  database: DatabaseSync,
  input: UpdateRecordInput
): DatabaseRecordResponse =>
  guarded(() =>
    withWriteTransaction(database, () => {
      const meta = requireTable(database, input.table)
      requireWritable(meta, "update")
      const primaryKeyColumns = requireReliablePrimaryKey(
        meta,
        "按主键定位记录"
      )
      const names = Object.keys(input.values)
      if (names.length === 0) {
        throw new DatabaseMutationError(400, "至少要修改一列")
      }
      assertWritableColumns(meta, input.values, { allowPrimaryKey: false })
      const key = resolveKey(primaryKeyColumns, input.key)
      const selectColumns = selectColumnsOf(meta)

      const current = readRow(database, meta, key)
      if (!current) {
        throw new DatabaseMutationError(404, "记录不存在")
      }
      if (
        toRecord(selectColumns, primaryKeyColumns, current).signature !==
        input.expectedSignature
      ) {
        throw new DatabaseMutationError(409, "记录已变化，请重新读取后再修改")
      }

      const sql = `UPDATE ${quoteIdentifier(meta.name)} SET ${names
        .map((name) => `${quoteIdentifier(name)} = ?`)
        .join(", ")} WHERE ${whereOf(key)} RETURNING ${returningOf(meta)}`
      const rows = database
        .prepare(sql)
        .all(
          ...names.map((name) => decodeSqliteValue(input.values[name])),
          ...paramsOf(key)
        ) as Row[]
      const row = rows[0]
      if (!row) {
        throw new DatabaseMutationError(409, "记录已变化，请重新读取后再修改")
      }
      const response: DatabaseRecordResponse = {
        table: meta.name,
        record: toRecord(selectColumns, primaryKeyColumns, row),
      }
      assertResponseSize(response)
      return response
    })
  )

export type DeleteRecordsInput = {
  table: string
  items: Array<{
    key: DatabaseRecordLocatorKey
    expectedSignature: string
  }>
}

/** 批量删除要么全成功要么全回滚：对象冲突或不存在都不允许部分删除。 */
export const deleteRecords = (
  database: DatabaseSync,
  input: DeleteRecordsInput
): DatabaseDeleteResult =>
  guarded(() =>
    withWriteTransaction(database, () => {
      const meta = requireTable(database, input.table)
      requireWritable(meta, "delete")
      const primaryKeyColumns = requireReliablePrimaryKey(
        meta,
        "按主键定位记录"
      )
      if (input.items.length === 0) {
        throw new DatabaseMutationError(400, "至少要删除一条记录")
      }
      if (input.items.length > MUTATION_DELETE_MAX) {
        throw new DatabaseMutationError(
          400,
          `一次最多删除 ${MUTATION_DELETE_MAX} 条记录`
        )
      }
      const selectColumns = selectColumnsOf(meta)
      const seen = new Set<string>()
      const keys = input.items.map((item, index) => {
        const key = resolveKey(primaryKeyColumns, item.key)
        const fingerprint = JSON.stringify(
          key.map((part) => [part.column.name, part.value])
        )
        if (seen.has(fingerprint)) {
          throw new DatabaseMutationError(
            400,
            `第 ${index + 1} 条与前面的目标重复，同一个目标不能提交两次`
          )
        }
        seen.add(fingerprint)
        return key
      })

      for (const [index, item] of input.items.entries()) {
        const key = keys[index]
        const current = readRow(database, meta, key)
        if (!current) {
          throw new DatabaseMutationError(404, `第 ${index + 1} 条记录不存在`)
        }
        if (
          toRecord(selectColumns, primaryKeyColumns, current).signature !==
          item.expectedSignature
        ) {
          throw new DatabaseMutationError(
            409,
            `第 ${index + 1} 条记录已变化，请重新读取后再删除`
          )
        }
        const outcome = database
          .prepare(
            `DELETE FROM ${quoteIdentifier(meta.name)} WHERE ${whereOf(key)}`
          )
          .run(...paramsOf(key))
        if (Number(outcome.changes) !== 1) {
          throw new DatabaseMutationError(
            409,
            `第 ${index + 1} 条记录没有按主键删除成功，事务已回滚`
          )
        }
      }

      return {
        deleted: input.items.map((item) => item.key),
        conflicts: [],
        failed: [],
      }
    })
  )
