import type { DatabaseSync } from "node:sqlite"
import type {
  DatabaseFilter,
  DatabaseRecord,
  DatabaseRecordResponse,
  DatabaseRecordsResponse,
  DatabaseSort,
  SqliteValue,
} from "@shared/api-contract"
import {
  DATABASE_FILTER_MAX,
  DATABASE_PAGE_SIZE_MAX,
  DATABASE_SORT_MAX,
} from "@shared/api-contract"
import {
  type ColumnMeta,
  requireTable,
  type TableMeta,
  tableSignature,
} from "./metadata"
import { DatabaseQueryError } from "./query-protocol"
import {
  decodeSqliteValue,
  encodeSqliteValue,
  rowSignature,
  type SqliteBindValue,
} from "./values"

/**
 * 有界只读查询：表名与列名先按真实元信息核验，值全部参数绑定，标识符一律
 * 双引号引用；任何超界都明确拒绝，不静默截断，也不为优化去建业务索引。
 */

/** 翻页上限：再往后翻既没意义又会拖慢扫描。 */
export const QUERY_PAGE_MAX = 100_000
/** 单次响应上限，超过就要求缩小页大小或加筛选条件。 */
export const QUERY_RESPONSE_MAX_BYTES = 2 * 1024 * 1024
/** 有界计数的行上限与时间预算；越过任一条就把 total 记成 null。 */
export const QUERY_COUNT_ROW_LIMIT = 10_000
export const QUERY_COUNT_BUDGET_MS = 1000

export type QueryLimits = {
  countRowLimit?: number
  countBudgetMs?: number
  responseMaxBytes?: number
}

export type ListRecordsInput = {
  table: string
  page: number
  pageSize: number
  filters: DatabaseFilter[]
  sorts: DatabaseSort[]
}

/** 双引号引用标识符，内部引号翻倍；名字来自真实元信息，仍然必须引用。 */
export const quoteIdentifier = (name: string): string =>
  `"${name.replaceAll('"', '""')}"`

const escapeLike = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")

const assertPaging = (input: ListRecordsInput): void => {
  if (
    !Number.isInteger(input.pageSize) ||
    input.pageSize < 1 ||
    input.pageSize > DATABASE_PAGE_SIZE_MAX
  ) {
    throw new DatabaseQueryError(
      400,
      `页大小必须在 1 到 ${DATABASE_PAGE_SIZE_MAX} 之间`
    )
  }
  if (
    !Number.isInteger(input.page) ||
    input.page < 1 ||
    input.page > QUERY_PAGE_MAX
  ) {
    throw new DatabaseQueryError(400, `页码必须在 1 到 ${QUERY_PAGE_MAX} 之间`)
  }
  if (input.filters.length > DATABASE_FILTER_MAX) {
    throw new DatabaseQueryError(400, `筛选条件最多 ${DATABASE_FILTER_MAX} 个`)
  }
  if (input.sorts.length > DATABASE_SORT_MAX) {
    throw new DatabaseQueryError(400, `排序字段最多 ${DATABASE_SORT_MAX} 个`)
  }
}

const assertKnownColumns = (meta: TableMeta, columns: string[]): void => {
  const known = new Set(meta.columns.map((column) => column.name))
  for (const name of columns) {
    if (!known.has(name)) {
      throw new DatabaseQueryError(400, `列「${name}」不存在`)
    }
  }
}

const filterValue = (filter: DatabaseFilter): SqliteValue => {
  if (filter.value === undefined) {
    throw new DatabaseQueryError(400, `算子 ${filter.operator} 必须提供取值`)
  }
  return filter.value
}

const textFilterValue = (filter: DatabaseFilter): string => {
  const value = filterValue(filter)
  if (value.type !== "text") {
    throw new DatabaseQueryError(400, `算子 ${filter.operator} 只支持文本取值`)
  }
  return value.value
}

const COMPARISON_SQL: Record<string, string> = {
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
}

const buildWhere = (
  filters: DatabaseFilter[]
): { sql: string; params: SqliteBindValue[] } => {
  const clauses: string[] = []
  const params: SqliteBindValue[] = []
  for (const filter of filters) {
    const column = quoteIdentifier(filter.column)
    const comparison = COMPARISON_SQL[filter.operator]
    if (comparison) {
      clauses.push(`${column} ${comparison} ?`)
      params.push(decodeSqliteValue(filterValue(filter)))
      continue
    }
    switch (filter.operator) {
      case "isNull":
        clauses.push(`${column} IS NULL`)
        break
      case "isNotNull":
        clauses.push(`${column} IS NOT NULL`)
        break
      case "eq":
      case "ne": {
        const value = filterValue(filter)
        if (value.type === "null") {
          // SQL 里 = NULL 永远不成立，必须换成 IS NULL / IS NOT NULL
          clauses.push(
            `${column} IS ${filter.operator === "eq" ? "" : "NOT "}NULL`
          )
          break
        }
        clauses.push(`${column} ${filter.operator === "eq" ? "=" : "<>"} ?`)
        params.push(decodeSqliteValue(value))
        break
      }
      case "contains":
      case "startsWith": {
        const value = textFilterValue(filter)
        const pattern =
          filter.operator === "contains"
            ? `%${escapeLike(value)}%`
            : `${escapeLike(value)}%`
        clauses.push(`${column} LIKE ? ESCAPE '\\'`)
        params.push(pattern)
        break
      }
    }
  }
  return {
    sql: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
  }
}

/** 排序：用户排序在前，再补主键，保证翻页时顺序稳定。 */
const buildOrderBy = (meta: TableMeta, sorts: DatabaseSort[]): string => {
  const terms: string[] = []
  const seen = new Set<string>()
  for (const sort of sorts) {
    if (seen.has(sort.column)) continue
    seen.add(sort.column)
    terms.push(
      `${quoteIdentifier(sort.column)} ${sort.direction === "desc" ? "DESC" : "ASC"}`
    )
  }
  for (const column of meta.primaryKey) {
    if (seen.has(column)) continue
    seen.add(column)
    terms.push(`${quoteIdentifier(column)} ASC`)
  }
  if (terms.length === 0) {
    throw new DatabaseQueryError(
      400,
      `表「${meta.name}」没有主键，必须指定排序字段才能稳定分页`
    )
  }
  return ` ORDER BY ${terms.join(", ")}`
}

const encodeCell = (column: string, raw: unknown): SqliteValue => {
  try {
    return encodeSqliteValue(raw)
  } catch (error) {
    if (error instanceof DatabaseQueryError) {
      throw new DatabaseQueryError(
        error.httpStatus,
        `列「${column}」：${error.message}`
      )
    }
    throw error
  }
}

/** 主键列（带类型信息），顺序与表的主键顺序一致。 */
export const primaryKeyColumnsOf = (meta: TableMeta): ColumnMeta[] => {
  const columns: ColumnMeta[] = []
  for (const name of meta.primaryKey) {
    const column = meta.columns.find((item) => item.name === name)
    if (column) columns.push(column)
  }
  return columns
}

export const toRecord = (
  selectColumns: ColumnMeta[],
  primaryKeyColumns: ColumnMeta[],
  row: Record<string, unknown>
): DatabaseRecord => {
  const values: Record<string, SqliteValue> = {}
  for (const column of selectColumns) {
    values[column.name] = encodeCell(column.name, row[column.name])
  }
  return {
    key: primaryKeyColumns.map((column) => ({
      column: column.name,
      value: encodeCell(column.name, row[column.name]),
    })),
    values,
    signature: rowSignature(values),
  }
}

/**
 * 有界计数：不跑无上限的 COUNT(*)，只按行上限与时间预算扫一遍；
 * 越过任一条就返回 null，绝不把「不知道」写成 0。
 */
const countRows = (
  database: DatabaseSync,
  table: string,
  whereSql: string,
  params: SqliteBindValue[],
  limits: QueryLimits
): number | null => {
  const rowLimit = limits.countRowLimit ?? QUERY_COUNT_ROW_LIMIT
  const budgetMs = limits.countBudgetMs ?? QUERY_COUNT_BUDGET_MS
  const startedAt = Date.now()
  const statement = database.prepare(
    `SELECT 1 FROM ${quoteIdentifier(table)}${whereSql} LIMIT ?`
  )
  const iterator = statement.iterate(...params, rowLimit + 1)
  let count = 0
  while (!iterator.next().done) {
    count += 1
    if (count > rowLimit) return null
    if (Date.now() - startedAt > budgetMs) return null
  }
  return count
}

const assertResponseSize = (response: unknown, limits: QueryLimits): void => {
  const maxBytes = limits.responseMaxBytes ?? QUERY_RESPONSE_MAX_BYTES
  if (Buffer.byteLength(JSON.stringify(response), "utf8") > maxBytes) {
    throw new DatabaseQueryError(
      400,
      `结果超过 ${Math.floor(maxBytes / (1024 * 1024))}MiB，请缩小页大小或加筛选条件`
    )
  }
}

/** 读取时要选的列：可见列，外加隐藏的主键列（定位需要）。 */
export const selectColumnsOf = (meta: TableMeta): ColumnMeta[] => {
  const columns = meta.columns.filter((column) => !column.hidden)
  const names = new Set(columns.map((column) => column.name))
  for (const column of primaryKeyColumnsOf(meta)) {
    if (!names.has(column.name)) columns.push(column)
  }
  if (columns.length === 0) {
    throw new DatabaseQueryError(400, `表「${meta.name}」没有可读的列`)
  }
  return columns
}

export const listRecords = (
  database: DatabaseSync,
  input: ListRecordsInput,
  limits: QueryLimits = {}
): DatabaseRecordsResponse => {
  assertPaging(input)
  const meta = requireTable(database, input.table)
  assertKnownColumns(meta, [
    ...input.filters.map((filter) => filter.column),
    ...input.sorts.map((sort) => sort.column),
  ])

  const selectColumns = selectColumnsOf(meta)
  const primaryKeyColumns = primaryKeyColumnsOf(meta)
  const where = buildWhere(input.filters)
  const orderBy = buildOrderBy(meta, input.sorts)
  const offset = (input.page - 1) * input.pageSize
  const statement = database.prepare(
    `SELECT ${selectColumns
      .map((column) => quoteIdentifier(column.name))
      .join(
        ", "
      )} FROM ${quoteIdentifier(meta.name)}${where.sql}${orderBy} LIMIT ? OFFSET ?`
  )
  const rows = statement.all(...where.params, input.pageSize, offset) as Array<
    Record<string, unknown>
  >

  const response: DatabaseRecordsResponse = {
    table: meta.name,
    records: rows.map((row) => toRecord(selectColumns, primaryKeyColumns, row)),
    page: input.page,
    pageSize: input.pageSize,
    total: countRows(database, meta.name, where.sql, where.params, limits),
    signature: tableSignature(database, meta),
  }
  assertResponseSize(response, limits)
  return response
}

export type GetRecordInput = {
  table: string
  key: Array<{ column: string; value: SqliteValue }>
}

export const getRecord = (
  database: DatabaseSync,
  input: GetRecordInput,
  limits: QueryLimits = {}
): DatabaseRecordResponse => {
  const meta = requireTable(database, input.table)
  const primaryKeyColumns = primaryKeyColumnsOf(meta)
  if (!meta.reliablePrimaryKey || primaryKeyColumns.length === 0) {
    throw new DatabaseQueryError(
      400,
      `表「${meta.name}」没有可靠主键，不能按主键定位记录`
    )
  }
  const given = new Map(input.key.map((part) => [part.column, part.value]))
  if (
    given.size !== primaryKeyColumns.length ||
    primaryKeyColumns.some((column) => !given.has(column.name))
  ) {
    throw new DatabaseQueryError(
      400,
      `主键必须完整给出：${primaryKeyColumns.map((column) => column.name).join(", ")}`
    )
  }

  const selectColumns = selectColumnsOf(meta)
  const where = primaryKeyColumns
    .map((column) => `${quoteIdentifier(column.name)} = ?`)
    .join(" AND ")
  const params = primaryKeyColumns.map((column) =>
    decodeSqliteValue(given.get(column.name) as SqliteValue)
  )
  const row = database
    .prepare(
      `SELECT ${selectColumns
        .map((column) => quoteIdentifier(column.name))
        .join(", ")} FROM ${quoteIdentifier(meta.name)} WHERE ${where} LIMIT 1`
    )
    .get(...params) as Record<string, unknown> | undefined
  if (!row) {
    throw new DatabaseQueryError(404, "记录不存在")
  }
  const response: DatabaseRecordResponse = {
    table: meta.name,
    record: toRecord(selectColumns, primaryKeyColumns, row),
  }
  assertResponseSize(response, limits)
  return response
}
