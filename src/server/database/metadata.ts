import { createHash } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"
import type {
  DatabaseCapability,
  DatabaseColumn,
  DatabaseColumnAffinity,
  DatabaseConstraints,
  DatabaseOperationDisabledReason,
  DatabaseTable,
  DatabaseTableKind,
  DatabaseTableSummary,
  SqliteValue,
} from "@shared/api-contract"
import { DatabaseQueryError } from "./query-protocol"

/**
 * 表结构发现：全部来自 SQLite 自己的元信息（pragma_table_list / table_xinfo /
 * index_list / index_xinfo / foreign_key_list 与 sqlite_schema 的触发器），
 * 不假定业务表有域前缀，也不维护表名白名单，所以新建表不用重启就能被发现。
 */

type SqlParam = string | number | bigint | null | Uint8Array

type Row = Record<string, unknown>

/** SQLite 的四种对象：普通表、视图、虚拟表、虚拟表的影子表。 */
type TableType = "table" | "view" | "virtual" | "shadow"

export type ColumnMeta = {
  name: string
  declaredType: string
  affinity: DatabaseColumnAffinity
  notNull: boolean
  /** 省略表示没有 DEFAULT 子句；{ type: "null" } 表示显式 DEFAULT NULL。 */
  defaultValue?: SqliteValue
  primaryKeyPosition: number
  generated: boolean
  hidden: boolean
}

export type TableMeta = {
  name: string
  type: TableType
  kind: DatabaseTableKind
  withoutRowId: boolean
  columns: ColumnMeta[]
  /** 按位置排序的主键列名；空数组表示没有主键。 */
  primaryKey: string[]
  /** 主键是否足以可靠定位一行；rowid 不算，隐藏 rowid 也不能冒充主键。 */
  reliablePrimaryKey: boolean
  capabilities: DatabaseCapability[]
  triggers: string[]
}

const query = (
  database: DatabaseSync,
  sql: string,
  params: SqlParam[] = []
): Row[] => database.prepare(sql).all(...params) as Row[]

const asText = (value: unknown): string =>
  typeof value === "string" ? value : ""

const asNullableText = (value: unknown): string | null =>
  typeof value === "string" ? value : null

const asNumber = (value: unknown): number => Number(value)

const asTableType = (value: unknown): TableType => {
  const text = asText(value)
  return text === "view" || text === "virtual" || text === "shadow"
    ? text
    : "table"
}

/** SQLite 的亲和性判定规则，顺序不能变。 */
export const affinityOf = (declaredType: string): DatabaseColumnAffinity => {
  const upper = declaredType.toUpperCase()
  if (upper.includes("INT")) return "integer"
  if (
    upper.includes("CHAR") ||
    upper.includes("CLOB") ||
    upper.includes("TEXT")
  ) {
    return "text"
  }
  if (upper.includes("BLOB") || upper.trim() === "") return "blob"
  if (
    upper.includes("REAL") ||
    upper.includes("FLOA") ||
    upper.includes("DOUB")
  ) {
    return "real"
  }
  return "numeric"
}

const INT64_MIN = -9223372036854775808n
const INT64_MAX = 9223372036854775807n

/**
 * 默认值原文是 SQL 文本，这里只做能确定的还原：NULL、整数、实数、字符串字面量
 * 直接给出值，其它表达式（CURRENT_TIMESTAMP、函数调用等）原样当文本展示。
 */
export const parseDefaultValue = (
  raw: string | null
): SqliteValue | undefined => {
  if (raw === null) return undefined
  const trimmed = raw.trim()
  if (trimmed.toUpperCase() === "NULL") return { type: "null" }
  if (/^-?\d+$/.test(trimmed)) {
    const parsed = BigInt(trimmed)
    if (parsed >= INT64_MIN && parsed <= INT64_MAX) {
      return { type: "integer", value: trimmed }
    }
    return { type: "text", value: trimmed }
  }
  if (/^-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed)) return { type: "real", value: parsed }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return { type: "text", value: trimmed.slice(1, -1).replaceAll("''", "'") }
  }
  return { type: "text", value: trimmed }
}

const readTableRows = (
  database: DatabaseSync
): Array<{ name: string; type: TableType; withoutRowId: boolean }> =>
  query(
    database,
    "SELECT name, type, wr FROM pragma_table_list WHERE schema = ? ORDER BY name",
    ["main"]
  ).map((row) => ({
    name: asText(row.name),
    type: asTableType(row.type),
    withoutRowId: asNumber(row.wr) === 1,
  }))

const readColumns = (database: DatabaseSync, table: string): ColumnMeta[] =>
  query(
    database,
    `SELECT cid, name, type, "notnull", dflt_value, pk, hidden
       FROM pragma_table_xinfo(?) ORDER BY cid`,
    [table]
  ).map((row) => {
    const hidden = asNumber(row.hidden)
    const column: ColumnMeta = {
      name: asText(row.name),
      declaredType: asText(row.type),
      affinity: affinityOf(asText(row.type)),
      notNull: asNumber(row.notnull) === 1,
      primaryKeyPosition: asNumber(row.pk),
      generated: hidden === 2 || hidden === 3,
      hidden: hidden === 1,
    }
    const defaultValue = parseDefaultValue(asNullableText(row.dflt_value))
    if (defaultValue !== undefined) column.defaultValue = defaultValue
    return column
  })

type IndexRow = {
  name: string
  unique: boolean
  origin: string
  partial: boolean
}

const readIndexes = (database: DatabaseSync, table: string): IndexRow[] =>
  query(
    database,
    `SELECT name, "unique", origin, partial FROM pragma_index_list(?) ORDER BY seq`,
    [table]
  ).map((row) => ({
    name: asText(row.name),
    unique: asNumber(row.unique) === 1,
    origin: asText(row.origin),
    partial: asNumber(row.partial) === 1,
  }))

/** 索引的键列；表达式索引没有列名，返回 null 表示无法用列名表达。 */
const readIndexColumns = (
  database: DatabaseSync,
  index: string
): string[] | null => {
  const names: string[] = []
  for (const row of query(
    database,
    'SELECT name FROM pragma_index_xinfo(?) WHERE "key" = 1 ORDER BY seqno',
    [index]
  )) {
    const name = asNullableText(row.name)
    if (name === null) return null
    names.push(name)
  }
  return names
}

const readForeignKeys = (
  database: DatabaseSync,
  table: string,
  primaryKeyOf: (name: string) => string[]
): DatabaseConstraints["foreignKeys"] => {
  const grouped = new Map<
    number,
    {
      columns: string[]
      referencedTable: string
      referencedColumns: string[]
      onDelete: string
      onUpdate: string
    }
  >()
  for (const row of query(
    database,
    `SELECT id, seq, "table", "from", "to", on_update, on_delete
       FROM pragma_foreign_key_list(?) ORDER BY id, seq`,
    [table]
  )) {
    const id = asNumber(row.id)
    const referencedTable = asText(row.table)
    const referencedColumn = asNullableText(row.to)
    let entry = grouped.get(id)
    if (!entry) {
      entry = {
        columns: [],
        referencedTable,
        // 没写引用列时指向父表主键，这里补全，不能留空
        referencedColumns: [],
        onDelete: asText(row.on_delete),
        onUpdate: asText(row.on_update),
      }
      grouped.set(id, entry)
    }
    entry.columns.push(asText(row.from))
    if (referencedColumn !== null)
      entry.referencedColumns.push(referencedColumn)
    else if (entry.referencedColumns.length === 0) {
      entry.referencedColumns.push(...primaryKeyOf(referencedTable))
    }
  }
  return [...grouped.entries()]
    .map(([id, entry]) => ({ id, ...entry }))
    .filter((entry) => entry.referencedColumns.length > 0)
}

const readTriggers = (database: DatabaseSync, table: string): string[] =>
  query(
    database,
    "SELECT name FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = ? ORDER BY name",
    [table]
  ).map((row) => asText(row.name))

const readTableSql = (database: DatabaseSync, name: string): string => {
  const row = database
    .prepare("SELECT sql FROM sqlite_schema WHERE name = ?")
    .get(name)
  return asNullableText(row?.sql) ?? ""
}

/**
 * 主键是否可靠：必须有显式主键，并且能保证非空唯一。
 *
 * - WITHOUT ROWID 的主键隐含 NOT NULL；
 * - 单列 INTEGER PRIMARY KEY 是 rowid 别名，永远非空，但没有对应索引；
 *   声明成 INTEGER PRIMARY KEY DESC 时 SQLite 会另建 pk 索引，那就按普通列处理；
 * - 其余情况要求每一列都显式 NOT NULL，否则 NULL 无法定位，宁可只读。
 */
const isReliablePrimaryKey = (
  withoutRowId: boolean,
  primaryKeyColumns: ColumnMeta[],
  hasPrimaryKeyIndex: boolean
): boolean => {
  if (primaryKeyColumns.length === 0) return false
  if (withoutRowId) return true
  if (
    primaryKeyColumns.length === 1 &&
    primaryKeyColumns[0].declaredType.trim().toUpperCase() === "INTEGER" &&
    !hasPrimaryKeyIndex
  ) {
    return true
  }
  return primaryKeyColumns.every((column) => column.notNull)
}

const disabledReasonFor = (
  meta: Pick<TableMeta, "name" | "type" | "reliablePrimaryKey">,
  moduleName: string
): { reason: DatabaseOperationDisabledReason; message: string } | null => {
  if (meta.type === "view") {
    return { reason: "view", message: "视图没有可直接写入的存储，只读" }
  }
  if (meta.type === "virtual") {
    return {
      reason: "virtual_table",
      message: `虚拟表${moduleName ? `（${moduleName}）` : ""}没有普通存储，只读`,
    }
  }
  if (meta.type === "shadow") {
    return {
      reason: "shadow_table",
      message: "虚拟表的影子表是实现细节，只读",
    }
  }
  if (meta.name.startsWith("sqlite_")) {
    return { reason: "system_table", message: "SQLite 内部表，只读" }
  }
  if (!meta.reliablePrimaryKey) {
    return {
      reason: "no_primary_key",
      message: "没有显式可靠的非空唯一主键，无法安全定位单条记录，只读",
    }
  }
  return null
}

const buildCapabilities = (
  meta: Pick<TableMeta, "name" | "type" | "reliablePrimaryKey">,
  moduleName: string
): DatabaseCapability[] => {
  const disabled = disabledReasonFor(meta, moduleName)
  if (!disabled) {
    return [
      { operation: "read", allowed: true },
      { operation: "insert", allowed: true },
      { operation: "update", allowed: true },
      { operation: "delete", allowed: true },
    ]
  }
  const reason = disabled
  return [
    { operation: "read", allowed: true },
    { operation: "insert", allowed: false, ...reason },
    { operation: "update", allowed: false, ...reason },
    { operation: "delete", allowed: false, ...reason },
  ]
}

const writeCapabilityOf = (column: ColumnMeta): DatabaseColumn["write"] => {
  if (column.hidden) {
    return {
      allowed: false,
      reason: "hidden",
      message: "虚拟表隐藏列，不参与普通读写",
    }
  }
  if (column.generated) {
    return {
      allowed: false,
      reason: "generated",
      message: "生成列由数据库计算，不能写入",
    }
  }
  if (column.affinity === "blob") {
    return {
      allowed: false,
      reason: "blob_read_only",
      message: "首期 BLOB 只读",
    }
  }
  return { allowed: true }
}

const readTableMeta = (
  database: DatabaseSync,
  table: string
): TableMeta | null => {
  const row = readTableRows(database).find((item) => item.name === table)
  if (!row) return null

  const columns = readColumns(database, row.name)
  const primaryKeyColumns = columns
    .filter((column) => column.primaryKeyPosition > 0)
    .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition)
  const indexes = readIndexes(database, row.name)
  const reliablePrimaryKey = isReliablePrimaryKey(
    row.withoutRowId,
    primaryKeyColumns,
    indexes.some((index) => index.origin === "pk")
  )
  const ddl = readTableSql(database, row.name)
  const moduleName = /USING\s+([A-Za-z0-9_]+)/i.exec(ddl)?.[1] ?? ""
  const meta: TableMeta = {
    name: row.name,
    type: row.type,
    kind: row.type === "view" ? "view" : "table",
    withoutRowId: row.withoutRowId,
    columns,
    primaryKey: primaryKeyColumns.map((column) => column.name),
    reliablePrimaryKey,
    capabilities: [],
    triggers: readTriggers(database, row.name),
  }
  meta.capabilities = buildCapabilities(meta, moduleName)
  return meta
}

const signatureOf = (
  meta: TableMeta,
  constraints: DatabaseConstraints
): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        name: meta.name,
        type: meta.type,
        withoutRowId: meta.withoutRowId,
        columns: meta.columns.map((column) => [
          column.name,
          column.declaredType,
          column.notNull,
          column.defaultValue === undefined ? "none" : column.defaultValue,
          column.primaryKeyPosition,
          column.generated,
          column.hidden,
        ]),
        constraints,
        triggers: meta.triggers,
      })
    )
    .digest("hex")
    .slice(0, 32)

const toColumn = (column: ColumnMeta): DatabaseColumn => {
  const result: DatabaseColumn = {
    name: column.name,
    declaredType: column.declaredType,
    affinity: column.affinity,
    notNull: column.notNull,
    primaryKeyPosition: column.primaryKeyPosition,
    generated: column.generated,
    hidden: column.hidden,
    write: writeCapabilityOf(column),
  }
  if (column.defaultValue !== undefined)
    result.defaultValue = column.defaultValue
  return result
}

const constraintsOf = (
  database: DatabaseSync,
  meta: TableMeta
): DatabaseConstraints => {
  const primaryKeyOf = (name: string): string[] => {
    const target = readTableMeta(database, name)
    return target?.primaryKey ?? []
  }
  const unique: DatabaseConstraints["unique"] = []
  for (const index of readIndexes(database, meta.name)) {
    if (!index.unique || index.partial || index.origin === "pk") continue
    const columns = readIndexColumns(database, index.name)
    // 表达式索引无法用列名表达，跳过而不是给一个错的列
    if (columns === null || columns.length === 0) continue
    unique.push({ name: index.name, columns })
  }
  return {
    primaryKey: meta.primaryKey,
    unique,
    foreignKeys: readForeignKeys(database, meta.name, primaryKeyOf),
    // 解析 CHECK 需要理解 DDL，本期不做；DDL 变化已计入结构签名
    checks: [],
  }
}

/** 表结构签名：查询响应里带上它，页面据此发现结构已变化。 */
export const tableSignature = (
  database: DatabaseSync,
  meta: TableMeta
): string => signatureOf(meta, constraintsOf(database, meta))

/** 表列表：只读元信息，不逐表 COUNT，行数一律为 null。 */
export const listTables = (database: DatabaseSync): DatabaseTableSummary[] =>
  readTableRows(database).flatMap((row) => {
    const meta = readTableMeta(database, row.name)
    // 两次读取之间表可能被删掉，宁可不列也不给一个能力不完整的条目
    if (!meta) return []
    return [
      {
        name: row.name,
        kind: row.type === "view" ? "view" : "table",
        rowCount: null,
        capabilities: meta.capabilities,
      },
    ]
  })

/** 单表结构；表不存在时返回 null。 */
export const getTable = (
  database: DatabaseSync,
  table: string
): DatabaseTable | null => {
  const meta = readTableMeta(database, table)
  if (!meta) return null
  const constraints = constraintsOf(database, meta)
  return {
    name: meta.name,
    kind: meta.kind,
    rowCount: null,
    capabilities: meta.capabilities,
    columns: meta.columns.map(toColumn),
    constraints,
    signature: signatureOf(meta, constraints),
    withoutRowId: meta.withoutRowId,
    triggers: meta.triggers,
  }
}

/** 查询入口用：表不存在直接 404，而不是退化成空结果。 */
export const requireTable = (
  database: DatabaseSync,
  table: string
): TableMeta => {
  const meta = readTableMeta(database, table)
  if (!meta) {
    throw new DatabaseQueryError(404, `表或视图「${table}」不存在`)
  }
  return meta
}
