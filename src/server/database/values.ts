import { createHash, type Hash } from "node:crypto"
import type { SqliteValue } from "@shared/api-contract"
import {
  DATABASE_BLOB_MAX_BYTES,
  DATABASE_TEXT_MAX_LENGTH,
} from "@shared/api-contract"
import { DatabaseQueryError } from "./query-protocol"

/** 参数绑定用的值类型：node:sqlite 接受 null / number / bigint / string / Uint8Array。 */
export type SqliteBindValue = null | number | bigint | string | Uint8Array

const utf8ByteLength = (value: string): number =>
  new TextEncoder().encode(value).length

/**
 * 把 SQLite 读出来的值编成契约里的带标签值。
 *
 * - 连接开了 readBigInts，所以整数一定是 bigint，转成十进制字符串避免丢精度；
 *   JS number 因此只可能是 REAL。
 * - NULL 与空串是两种值，编码后仍然可区分。
 * - 超过单值上限时抛错，不静默截断可编辑的原值。
 * - 错误信息里不带任何原值内容，避免数据进入日志。
 */
export const encodeSqliteValue = (raw: unknown): SqliteValue => {
  if (raw === null) return { type: "null" }
  if (typeof raw === "bigint") return { type: "integer", value: raw.toString() }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      throw new DatabaseQueryError(400, "实数值不是有限数，无法返回")
    }
    return { type: "real", value: raw }
  }
  if (typeof raw === "string") {
    const bytes = utf8ByteLength(raw)
    if (bytes > DATABASE_TEXT_MAX_LENGTH) {
      throw new DatabaseQueryError(
        400,
        `文本值 ${bytes} 字节超过单值上限 ${DATABASE_TEXT_MAX_LENGTH} 字节，请缩小页大小或加筛选条件`
      )
    }
    return { type: "text", value: raw }
  }
  if (raw instanceof Uint8Array) {
    if (raw.byteLength > DATABASE_BLOB_MAX_BYTES) {
      throw new DatabaseQueryError(
        400,
        `BLOB 值 ${raw.byteLength} 字节超过单值上限 ${DATABASE_BLOB_MAX_BYTES} 字节，请缩小页大小或加筛选条件`
      )
    }
    return { type: "blob", base64: Buffer.from(raw).toString("base64") }
  }
  throw new DatabaseQueryError(500, "查询结果里出现了无法表示的值类型")
}

/** 把契约里的带标签值还原成可绑定的参数值。 */
export const decodeSqliteValue = (value: SqliteValue): SqliteBindValue => {
  switch (value.type) {
    case "null":
      return null
    case "text":
      return value.value
    case "integer":
      return BigInt(value.value)
    case "real":
      return value.value
    case "blob":
      return Buffer.from(value.base64, "base64")
  }
}

/**
 * 长度前缀写入：不同字段拼在一起也不会产生歧义（例如 "ab"+"c" 与 "a"+"bc"）。
 * 只把摘要交出去，原值不出现在签名里。
 */
const writeChunk = (hash: Hash, text: string): void => {
  const bytes = Buffer.from(text, "utf8")
  hash.update(`${bytes.length}:`)
  hash.update(bytes)
}

/**
 * 稳定行签名：同一行同样的值在任何进程、任何次读取里都得到同一个签名，
 * 用于乐观并发（expectedSignature）。列顺序不影响结果。
 */
export const rowSignature = (values: Record<string, SqliteValue>): string => {
  const hash = createHash("sha256")
  for (const column of Object.keys(values).sort()) {
    const value = values[column]
    writeChunk(hash, column)
    writeChunk(hash, value.type)
    switch (value.type) {
      case "null":
        break
      case "text":
        writeChunk(hash, value.value)
        break
      case "integer":
        writeChunk(hash, value.value)
        break
      case "real":
        writeChunk(hash, String(value.value))
        break
      case "blob":
        writeChunk(hash, value.base64)
        break
    }
  }
  return hash.digest("hex").slice(0, 32)
}
