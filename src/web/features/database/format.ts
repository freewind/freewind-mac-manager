import type {
  DatabaseColumn,
  DatabaseFilterOperator,
  DatabaseRecordLocatorKey,
  SqliteValue,
} from "@shared/api-contract"

/** 超过这个长度的文本在列表里先折叠，展开后看全文。 */
export const LONG_VALUE_LENGTH = 60

/**
 * 值的展示文本：NULL、空串与普通文本必须能一眼区分；
 * 整数原样用十进制字符串，绝不转成 Number（大整数会丢精度）。
 */
export const formatSqliteValue = (value: SqliteValue): string => {
  switch (value.type) {
    case "null":
      return "NULL"
    case "text":
      return value.value
    case "integer":
      return value.value
    case "real":
      return String(value.value)
    case "blob":
      return `BLOB ${blobByteLength(value.base64)} 字节`
  }
}

/** 值类型的中文标签，空串与 NULL 分开标注。 */
export const sqliteValueTypeLabel = (value: SqliteValue): string => {
  switch (value.type) {
    case "null":
      return "NULL"
    case "text":
      return value.value === "" ? "空字符串" : "文本"
    case "integer":
      return "整数"
    case "real":
      return "实数"
    case "blob":
      return "BLOB"
  }
}

/** base64 长度换算成原始字节数，不解码也不改内容。 */
const blobByteLength = (base64: string): number => {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
}

/**
 * 看起来是 JSON 的文本只加标注便于查看，绝不在展示层改写原字符串。
 */
export const looksLikeJson = (value: SqliteValue): boolean => {
  if (value.type !== "text") return false
  const trimmed = value.value.trim()
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

/** 记录定位文本，例如 `id=1` 或 `a=a1，b=2`。 */
export const formatRecordKey = (key: DatabaseRecordLocatorKey): string =>
  key.length === 0
    ? "（没有主键）"
    : key
        .map((part) => `${part.column}=${formatSqliteValue(part.value)}`)
        .join("，")

/** 主键取值的指纹，用于「当前页勾选」这类本地比较。 */
export const recordKeyFingerprint = (key: DatabaseRecordLocatorKey): string =>
  JSON.stringify(key.map((part) => [part.column, part.value]))

export const FILTER_OPERATOR_LABELS: Record<DatabaseFilterOperator, string> = {
  eq: "等于",
  ne: "不等于",
  contains: "包含",
  startsWith: "开头是",
  gt: "大于",
  gte: "大于等于",
  lt: "小于",
  lte: "小于等于",
  isNull: "为空",
  isNotNull: "不为空",
}

/** 只看是否为空的算子不需要取值。 */
export const operatorNeedsValue = (operator: DatabaseFilterOperator): boolean =>
  operator !== "isNull" && operator !== "isNotNull"

export const COLUMN_AFFINITY_LABELS: Record<
  DatabaseColumn["affinity"],
  string
> = {
  integer: "整数",
  real: "实数",
  text: "文本",
  blob: "二进制",
  numeric: "数值",
}

/**
 * 按列的亲和性把输入文本转成带标签值：
 * 整数列保留十进制字符串（不经过 Number），实数列才转 number。
 */
export const filterValueFromInput = (
  column: DatabaseColumn,
  text: string
): SqliteValue => {
  const trimmed = text.trim()
  if (column.affinity === "integer" && /^-?\d+$/.test(trimmed)) {
    return { type: "integer", value: trimmed }
  }
  if (
    column.affinity === "real" &&
    /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed) &&
    Number.isFinite(Number(trimmed))
  ) {
    return { type: "real", value: Number(trimmed) }
  }
  return { type: "text", value: text }
}

/** 列的默认值展示：没有 DEFAULT 子句与显式 DEFAULT NULL 必须分开。 */
export const formatColumnDefault = (column: DatabaseColumn): string =>
  column.defaultValue === undefined
    ? "无默认值"
    : formatSqliteValue(column.defaultValue)

/** 最后读取时间：精确到秒，够判断数据新鲜度。 */
export const formatReadAt = (milliseconds: number): string => {
  const date = new Date(milliseconds)
  const pad = (value: number): string => String(value).padStart(2, "0")
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
