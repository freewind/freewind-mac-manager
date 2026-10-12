import type {
  DatabaseColumn,
  DatabaseRecord,
  DatabaseTable,
  SqliteWritableValue,
} from "@shared/api-contract"
import { DATABASE_TEXT_MAX_LENGTH } from "@shared/api-contract"
import { formatSqliteValue } from "./format"

/**
 * 表单值到契约带标签值的转换。
 *
 * 只做存储层的判断，不假装拥有业务 schema：SQLite 的声明类型只是亲和性，
 * 不保证列里真的是那个类型，所以识别不了的值按文本原样提交，交给数据库决定，
 * 不在这里强行报错或改写用户输入。
 */

/** 新增时每一列的取值方式：省略（用默认值）、显式 NULL、输入值。 */
export type ColumnFormMode = "omit" | "null" | "value"

export type ColumnFormState = {
  mode: ColumnFormMode
  /** mode 为 value 时的原始输入，绝不在这里改写。 */
  text: string
}

export type RecordFormState = Record<string, ColumnFormState>

export type FormValuesResult = {
  values: Record<string, SqliteWritableValue>
  errors: Record<string, string>
}

const INT64_MIN = -9223372036854775808n
const INT64_MAX = 9223372036854775807n
const INTEGER_PATTERN = /^-?\d+$/
const NUMBER_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

const utf8ByteLength = (value: string): number =>
  new TextEncoder().encode(value).length

/** 可写字段：生成列、隐藏列与 BLOB 列（首期只读）不在这里。 */
export const writableColumnsOf = (table: DatabaseTable): DatabaseColumn[] =>
  table.columns.filter((column) => column.write.allowed && !column.hidden)

/** 只读字段：表单里照样展示，只是不能编辑。 */
export const readOnlyColumnsOf = (table: DatabaseTable): DatabaseColumn[] =>
  table.columns.filter((column) => !column.write.allowed || column.hidden)

/**
 * 新增时的默认取值方式：
 * - 有默认值 → 省略，交给数据库默认值；
 * - 单列 INTEGER PRIMARY KEY → 省略，让数据库生成；
 * - 其余非空列 → 留空文本等用户填；可空列 → NULL。
 */
const initialInsertMode = (
  column: DatabaseColumn,
  table: DatabaseTable
): ColumnFormMode => {
  if (column.defaultValue !== undefined) return "omit"
  if (
    column.primaryKeyPosition > 0 &&
    !column.notNull &&
    column.affinity === "integer" &&
    table.constraints.primaryKey.length === 1
  ) {
    return "omit"
  }
  return column.notNull ? "value" : "null"
}

export const emptyRecordForm = (table: DatabaseTable): RecordFormState =>
  Object.fromEntries(
    writableColumnsOf(table).map((column) => [
      column.name,
      { mode: initialInsertMode(column, table), text: "" },
    ])
  )

/** 修改时的初始状态：按当前记录逐列回填，NULL 与空串分开。 */
export const recordFormFromRecord = (
  table: DatabaseTable,
  record: DatabaseRecord
): RecordFormState =>
  Object.fromEntries(
    writableColumnsOf(table).map((column) => {
      const value = record.values[column.name]
      if (value === undefined || value.type === "null") {
        return [column.name, { mode: "null", text: "" }]
      }
      return [column.name, { mode: "value", text: formatSqliteValue(value) }]
    })
  )

const sameState = (
  left: ColumnFormState | undefined,
  right: ColumnFormState | undefined
): boolean => {
  if (left?.mode !== right?.mode) return false
  // NULL 就是 NULL，输入框里残留的文本不参与比较
  if (left?.mode === "null") return true
  return left?.text === right?.text
}

/** 相对初始状态真正改动过的列。 */
export const changedColumns = (
  initial: RecordFormState,
  current: RecordFormState
): string[] =>
  Object.keys(current).filter(
    (name) => !sameState(initial[name], current[name])
  )

export const hasFormChanges = (
  initial: RecordFormState,
  current: RecordFormState
): boolean => changedColumns(initial, current).length > 0

type Conversion = { value: SqliteWritableValue } | { error: string }

/** 十进制整数串：能装进 int64 就用整数，超出则按 SQLite 的行为存成实数。 */
const integerValue = (trimmed: string): SqliteWritableValue | null => {
  if (!INTEGER_PATTERN.test(trimmed)) return null
  const parsed = BigInt(trimmed)
  if (parsed >= INT64_MIN && parsed <= INT64_MAX) {
    return { type: "integer", value: trimmed }
  }
  return { type: "real", value: Number(trimmed) }
}

const realValue = (trimmed: string): SqliteWritableValue | null =>
  NUMBER_PATTERN.test(trimmed) && Number.isFinite(Number(trimmed))
    ? { type: "real", value: Number(trimmed) }
    : null

export const convertFormValue = (
  column: DatabaseColumn,
  state: ColumnFormState
): Conversion => {
  if (state.mode === "null") return { value: { type: "null" } }
  const text = state.text
  if (utf8ByteLength(text) > DATABASE_TEXT_MAX_LENGTH) {
    return {
      error: `文本超过单值上限 ${DATABASE_TEXT_MAX_LENGTH / 1024}KiB`,
    }
  }
  const trimmed = text.trim()
  switch (column.affinity) {
    case "integer":
      return { value: integerValue(trimmed) ?? { type: "text", value: text } }
    case "real":
      return { value: realValue(trimmed) ?? { type: "text", value: text } }
    // 混合存储类型：能识别就按识别结果，识别不了按文本原样提交
    case "numeric":
      return {
        value: integerValue(trimmed) ??
          realValue(trimmed) ?? { type: "text", value: text },
      }
    case "text":
      return { value: { type: "text", value: text } }
    case "blob":
      return { error: "BLOB 列首期只读，不能写入" }
  }
}

/** 新增：省略的列不进请求，交给数据库默认值。 */
export const buildInsertValues = (
  table: DatabaseTable,
  state: RecordFormState
): FormValuesResult => {
  const values: Record<string, SqliteWritableValue> = {}
  const errors: Record<string, string> = {}
  for (const column of writableColumnsOf(table)) {
    const current = state[column.name]
    if (current === undefined || current.mode === "omit") continue
    const converted = convertFormValue(column, current)
    if ("error" in converted) errors[column.name] = converted.error
    else values[column.name] = converted.value
  }
  return { values, errors }
}

/** 修改：只提交相对初始状态变化过的字段。 */
export const buildUpdateValues = (
  table: DatabaseTable,
  initial: RecordFormState,
  state: RecordFormState
): FormValuesResult => {
  const values: Record<string, SqliteWritableValue> = {}
  const errors: Record<string, string> = {}
  for (const column of writableColumnsOf(table)) {
    const current = state[column.name]
    if (current === undefined) continue
    if (sameState(initial[column.name], current)) continue
    const converted = convertFormValue(column, current)
    if ("error" in converted) errors[column.name] = converted.error
    else values[column.name] = converted.value
  }
  return { values, errors }
}
