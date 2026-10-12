import {
  DATABASE_BLOB_MAX_BYTES,
  DATABASE_TEXT_MAX_LENGTH,
} from "@shared/api-contract"
import { describe, expect, it } from "vitest"
import { DatabaseQueryError } from "./query-protocol"
import { decodeSqliteValue, encodeSqliteValue, rowSignature } from "./values"

describe("encodeSqliteValue", () => {
  it("keeps NULL and an empty string apart", () => {
    expect(encodeSqliteValue(null)).toEqual({ type: "null" })
    expect(encodeSqliteValue("")).toEqual({ type: "text", value: "" })
    expect(rowSignature({ a: encodeSqliteValue(null) })).not.toBe(
      rowSignature({ a: encodeSqliteValue("") })
    )
  })

  it("encodes integers as decimal strings so int64 precision survives", () => {
    // 9007199254740993 用 number 承载会变成 9007199254740992
    expect(encodeSqliteValue(9007199254740993n)).toEqual({
      type: "integer",
      value: "9007199254740993",
    })
    expect(encodeSqliteValue(-9223372036854775808n)).toEqual({
      type: "integer",
      value: "-9223372036854775808",
    })
  })

  it("round-trips every storage class", () => {
    const cases = [
      { type: "null" as const },
      { type: "text" as const, value: '含中文与引号 " 的值' },
      { type: "integer" as const, value: "9007199254740993" },
      { type: "real" as const, value: 1.5 },
      { type: "blob" as const, base64: "QUJD" },
    ]
    for (const value of cases) {
      expect(encodeSqliteValue(decodeSqliteValue(value))).toEqual(value)
    }
    expect(
      Array.from(
        decodeSqliteValue({ type: "blob", base64: "QUJD" }) as Uint8Array
      )
    ).toEqual([65, 66, 67])
    expect(decodeSqliteValue({ type: "integer", value: "7" })).toBe(7n)
  })

  it("rejects values beyond the single-value limit instead of truncating", () => {
    expect(() =>
      encodeSqliteValue("a".repeat(DATABASE_TEXT_MAX_LENGTH))
    ).not.toThrow()
    expect(() =>
      encodeSqliteValue("a".repeat(DATABASE_TEXT_MAX_LENGTH + 1))
    ).toThrow(DatabaseQueryError)
    // 非 ASCII 按 UTF-8 字节数算：3 字节一个汉字
    expect(() =>
      encodeSqliteValue("汉".repeat(Math.ceil(DATABASE_TEXT_MAX_LENGTH / 3)))
    ).toThrow(DatabaseQueryError)
    expect(() =>
      encodeSqliteValue(new Uint8Array(DATABASE_BLOB_MAX_BYTES + 1))
    ).toThrow(DatabaseQueryError)
  })

  it("keeps the original value out of the error message", () => {
    const secret = "SECRET-MARKER"
    try {
      encodeSqliteValue(secret.repeat(DATABASE_TEXT_MAX_LENGTH))
      throw new Error("应当抛错")
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseQueryError)
      expect((error as Error).message).not.toContain(secret)
      expect((error as Error).message).toContain("超过单值上限")
    }
  })

  it("rejects non-finite reals and unknown value types", () => {
    expect(() => encodeSqliteValue(Number.POSITIVE_INFINITY)).toThrow(
      DatabaseQueryError
    )
    expect(() => encodeSqliteValue({ nested: true })).toThrow(
      DatabaseQueryError
    )
  })
})

describe("rowSignature", () => {
  it("is stable and independent of column order", () => {
    const a = {
      id: { type: "integer" as const, value: "1" },
      name: { type: "text" as const, value: "a" },
    }
    const b = {
      name: { type: "text" as const, value: "a" },
      id: { type: "integer" as const, value: "1" },
    }
    expect(rowSignature(a)).toBe(rowSignature(b))
    expect(rowSignature(a)).toHaveLength(32)
  })

  it("changes when any value changes", () => {
    const base = {
      id: { type: "integer" as const, value: "1" },
      name: { type: "text" as const, value: "a" },
    }
    expect(rowSignature(base)).not.toBe(
      rowSignature({ ...base, name: { type: "text", value: "b" } })
    )
    expect(rowSignature(base)).not.toBe(
      rowSignature({ ...base, name: { type: "null" } })
    )
    // 拼接歧义不能产生相同签名
    expect(
      rowSignature({
        a: { type: "text", value: "ab" },
        b: { type: "text", value: "c" },
      })
    ).not.toBe(
      rowSignature({
        a: { type: "text", value: "a" },
        b: { type: "text", value: "bc" },
      })
    )
  })
})
