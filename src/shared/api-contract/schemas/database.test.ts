import { describe, expect, it } from "vitest"
import {
  DATABASE_BLOB_MAX_BYTES,
  DATABASE_COLUMN_MAX,
  DATABASE_DELETE_MAX,
  DATABASE_FILTER_MAX,
  DATABASE_IDENTIFIER_MAX_LENGTH,
  DATABASE_SORT_MAX,
  DATABASE_TEXT_MAX_LENGTH,
  DatabaseCapabilitySchema,
  DatabaseColumnSchema,
  DatabaseDeleteBodySchema,
  DatabaseDeleteResultSchema,
  DatabaseFilterSchema,
  DatabaseInsertBodySchema,
  DatabaseRecordKeySchema,
  DatabaseRecordLocatorKeySchema,
  DatabaseRecordsQuerySchema,
  DatabaseRecordsResponseSchema,
  DatabaseSortSchema,
  DatabaseTableSchema,
  DatabaseUpdateBodySchema,
  SqliteValueSchema,
  SqliteWritableValueSchema,
} from "./database"

const BLOB_BASE64_MAX_LENGTH = Math.ceil(DATABASE_BLOB_MAX_BYTES / 3) * 4

const integerValue = (value: string) => ({ type: "integer" as const, value })

const writableColumn = {
  name: "title",
  declaredType: "TEXT",
  affinity: "text" as const,
  notNull: false,
  primaryKeyPosition: 0,
  generated: false,
  hidden: false,
  write: { allowed: true as const },
}

const capabilities = [
  { operation: "read" as const, allowed: true as const },
  { operation: "insert" as const, allowed: true as const },
  { operation: "update" as const, allowed: true as const },
  { operation: "delete" as const, allowed: true as const },
]

const tableSummary = {
  name: "caddy_rules",
  kind: "table" as const,
  rowCount: 3,
  capabilities,
}

describe("database identifier schema", () => {
  it("accepts any real SQLite name and only rejects empty, control or oversized ones", () => {
    for (const name of [
      "caddy_rules",
      "_private",
      "1abc",
      "has space",
      "drop;table",
      'quote"d',
      "café",
      "😀",
    ]) {
      expect(
        DatabaseColumnSchema.safeParse({ ...writableColumn, name }).success
      ).toBe(true)
    }
    for (const name of [
      "",
      "bad\u0000name",
      "bad\nname",
      "a".repeat(DATABASE_IDENTIFIER_MAX_LENGTH + 1),
    ]) {
      expect(
        DatabaseColumnSchema.safeParse({ ...writableColumn, name }).success
      ).toBe(false)
    }
  })
})

describe("sqlite value schema", () => {
  it("keeps integers as decimal strings so int64 precision survives", () => {
    const parsed = SqliteValueSchema.parse(integerValue("9007199254740993"))
    // 用 number 承载会变成 9007199254740992，所以必须是字符串
    expect(parsed).toMatchInlineSnapshot(`
      {
        "type": "integer",
        "value": "9007199254740993",
      }
    `)
    expect(typeof (parsed as { value: unknown }).value).toBe("string")
    for (const value of ["9223372036854775807", "-9223372036854775808"]) {
      expect(SqliteValueSchema.safeParse(integerValue(value)).success).toBe(
        true
      )
    }
    for (const value of [
      "9223372036854775808",
      "-9223372036854775809",
      "1e5",
      "1.5",
      "0x10",
      "",
    ]) {
      expect(SqliteValueSchema.safeParse(integerValue(value)).success).toBe(
        false
      )
    }
  })

  it("accepts numbers and numeric strings for real, but not null or booleans", () => {
    expect(
      SqliteValueSchema.safeParse({ type: "real", value: 1.5 }).success
    ).toBe(true)
    // 查询串里的数字都是字符串
    expect(SqliteValueSchema.parse({ type: "real", value: "2.5" })).toEqual({
      type: "real",
      value: 2.5,
    })
    for (const value of [null, true, "abc", Number.POSITIVE_INFINITY]) {
      expect(SqliteValueSchema.safeParse({ type: "real", value }).success).toBe(
        false
      )
    }
  })

  it("bounds text and blob values", () => {
    expect(
      SqliteValueSchema.safeParse({
        type: "text",
        value: "a".repeat(DATABASE_TEXT_MAX_LENGTH),
      }).success
    ).toBe(true)
    expect(
      SqliteValueSchema.safeParse({
        type: "text",
        value: "a".repeat(DATABASE_TEXT_MAX_LENGTH + 1),
      }).success
    ).toBe(false)
    expect(
      SqliteValueSchema.safeParse({ type: "blob", base64: "QUJD" }).success
    ).toBe(true)
    expect(
      SqliteValueSchema.safeParse({
        type: "blob",
        base64: "A".repeat(BLOB_BASE64_MAX_LENGTH),
      }).success
    ).toBe(true)
    expect(
      SqliteValueSchema.safeParse({
        type: "blob",
        base64: "A".repeat(BLOB_BASE64_MAX_LENGTH + 1),
      }).success
    ).toBe(false)
    expect(
      SqliteValueSchema.safeParse({ type: "blob", base64: "not base64!" })
        .success
    ).toBe(false)
  })

  it("keeps blob read-only on the write side", () => {
    expect(
      SqliteValueSchema.safeParse({ type: "blob", base64: "QUJD" }).success
    ).toBe(true)
    expect(
      SqliteWritableValueSchema.safeParse({ type: "blob", base64: "QUJD" })
        .success
    ).toBe(false)
  })

  it("distinguishes an explicit NULL from an unknown value type", () => {
    expect(SqliteValueSchema.parse({ type: "null" })).toEqual({ type: "null" })
    expect(SqliteValueSchema.safeParse({ type: "NULL" }).success).toBe(false)
    expect(SqliteValueSchema.safeParse({ value: null }).success).toBe(false)
  })
})

describe("database column schema", () => {
  it("separates an omitted default from an explicit NULL default", () => {
    const withoutDefault = DatabaseColumnSchema.parse({
      ...writableColumn,
      name: "created_at",
    })
    // 没有 DEFAULT 子句时字段必须缺席，不能被压成 null
    expect("defaultValue" in withoutDefault).toBe(false)

    const withNullDefault = DatabaseColumnSchema.parse({
      ...writableColumn,
      name: "note",
      defaultValue: { type: "null" },
    })
    expect(withNullDefault.defaultValue).toEqual({ type: "null" })

    const withValueDefault = DatabaseColumnSchema.parse({
      ...writableColumn,
      name: "sort_order",
      defaultValue: integerValue("0"),
    })
    expect(withValueDefault.defaultValue).toEqual(integerValue("0"))
  })

  it("keeps generated columns out of the writable set", () => {
    const generated = DatabaseColumnSchema.parse({
      ...writableColumn,
      name: "total",
      generated: true,
      write: {
        allowed: false,
        reason: "generated",
        message: "生成列由数据库计算",
      },
    })
    expect(generated.write.allowed).toBe(false)
    // 禁用必须给原因，不能只留一个禁用的按钮
    expect(
      DatabaseColumnSchema.safeParse({
        ...writableColumn,
        generated: true,
        write: { allowed: false, message: "生成列" },
      }).success
    ).toBe(false)
  })
})

describe("database capability schema", () => {
  it("requires a reason and message when an operation is disabled", () => {
    expect(
      DatabaseCapabilitySchema.safeParse({
        operation: "insert",
        allowed: false,
        reason: "no_primary_key",
        message: "没有主键，无法安全定位记录",
      }).success
    ).toBe(true)
    expect(
      DatabaseCapabilitySchema.safeParse({
        operation: "insert",
        allowed: false,
        message: "没有主键",
      }).success
    ).toBe(false)
    expect(
      DatabaseCapabilitySchema.safeParse({
        operation: "insert",
        allowed: false,
        reason: "made_up_reason",
        message: "没有主键",
      }).success
    ).toBe(false)
  })

  const tableDetail = {
    columns: [writableColumn],
    constraints: { primaryKey: [], unique: [], foreignKeys: [], checks: [] },
    signature: "schema-1",
    withoutRowId: false,
    triggers: [],
  }

  it("requires every table to report all four operations", () => {
    expect(
      DatabaseTableSchema.safeParse({ ...tableSummary, ...tableDetail }).success
    ).toBe(true)
    expect(
      DatabaseTableSchema.safeParse({
        ...tableSummary,
        ...tableDetail,
        capabilities: capabilities.slice(0, 3),
      }).success
    ).toBe(false)
  })

  it("keeps an unknown row count nullable instead of zero", () => {
    expect(
      DatabaseTableSchema.safeParse({
        ...tableSummary,
        ...tableDetail,
        rowCount: null,
      }).success
    ).toBe(true)
    expect(
      DatabaseTableSchema.safeParse({
        ...tableSummary,
        ...tableDetail,
        rowCount: -1,
      }).success
    ).toBe(false)
  })

  it("reports trigger names so the page can warn about write side effects", () => {
    const parsed = DatabaseTableSchema.safeParse({
      ...tableSummary,
      ...tableDetail,
      triggers: ["trg_a", "trg_b"],
    })
    expect(parsed.success && parsed.data.triggers).toEqual(["trg_a", "trg_b"])
    expect(
      DatabaseTableSchema.safeParse({
        ...tableSummary,
        ...tableDetail,
        triggers: [1],
      }).success
    ).toBe(false)
  })
})

describe("database record key schema", () => {
  it("supports composite primary keys and rejects empty locators", () => {
    expect(
      DatabaseRecordKeySchema.safeParse([
        { column: "snapshot_id", value: integerValue("7") },
        { column: "path", value: { type: "text", value: "/tmp/a" } },
      ]).success
    ).toBe(true)
    // 没有可靠主键的表读出来的记录，主键就是空数组
    expect(DatabaseRecordKeySchema.safeParse([]).success).toBe(true)
    // 定位用的主键不能为空，否则会退化成整表操作
    expect(DatabaseRecordLocatorKeySchema.safeParse([]).success).toBe(false)
    expect(
      DatabaseRecordLocatorKeySchema.safeParse([
        { column: "id", value: integerValue("1") },
      ]).success
    ).toBe(true)
    expect(
      DatabaseRecordKeySchema.safeParse(
        Array.from({ length: 17 }, (_, index) => ({
          column: `c${index}`,
          value: integerValue("1"),
        }))
      ).success
    ).toBe(false)
    expect(
      DatabaseRecordKeySchema.safeParse([
        { column: "id", value: { type: "text", value: "x" } },
      ]).success
    ).toBe(true)
  })
})

describe("database records query schema", () => {
  it("defaults paging, filters and sorts", () => {
    expect(
      DatabaseRecordsQuerySchema.parse({}) satisfies Record<string, unknown>
    ).toMatchInlineSnapshot(`
      {
        "filters": [],
        "page": 1,
        "pageSize": 50,
        "sorts": [],
      }
    `)
  })

  it("bounds paging, filter count and sort count", () => {
    expect(DatabaseRecordsQuerySchema.safeParse({ page: 0 }).success).toBe(
      false
    )
    expect(
      DatabaseRecordsQuerySchema.safeParse({ pageSize: 201 }).success
    ).toBe(false)
    expect(
      DatabaseRecordsQuerySchema.safeParse({
        filters: Array.from({ length: DATABASE_FILTER_MAX + 1 }, () => ({
          column: "id",
          operator: "eq",
          value: integerValue("1"),
        })),
      }).success
    ).toBe(false)
    expect(
      DatabaseRecordsQuerySchema.safeParse({
        sorts: Array.from({ length: DATABASE_SORT_MAX + 1 }, () => ({
          column: "id",
          direction: "asc",
        })),
      }).success
    ).toBe(false)
  })

  it("ties the filter value to the operator", () => {
    expect(
      DatabaseFilterSchema.safeParse({ column: "note", operator: "isNull" })
        .success
    ).toBe(true)
    expect(
      DatabaseFilterSchema.safeParse({
        column: "note",
        operator: "isNull",
        value: { type: "null" },
      }).success
    ).toBe(false)
    expect(
      DatabaseFilterSchema.safeParse({ column: "note", operator: "eq" }).success
    ).toBe(false)
    expect(
      DatabaseFilterSchema.safeParse({
        column: "note",
        operator: "eq",
        value: { type: "text", value: "a" },
      }).success
    ).toBe(true)
    expect(
      DatabaseFilterSchema.safeParse({ column: "note", operator: "like" })
        .success
    ).toBe(false)
  })

  it("rejects an unknown sort direction", () => {
    expect(
      DatabaseSortSchema.safeParse({ column: "id", direction: "up" }).success
    ).toBe(false)
  })

  it("allows an unknown total in the response", () => {
    expect(
      DatabaseRecordsResponseSchema.safeParse({
        table: "caddy_rules",
        records: [],
        page: 1,
        pageSize: 50,
        total: null,
        signature: "schema-1",
      }).success
    ).toBe(true)
  })
})

describe("database write schemas", () => {
  it("accepts an all-defaults insert and rejects a too-wide one", () => {
    expect(DatabaseInsertBodySchema.safeParse({ values: {} }).success).toBe(
      true
    )
    expect(
      DatabaseInsertBodySchema.safeParse({
        values: { title: { type: "text", value: "a" } },
      }).success
    ).toBe(true)
    const wide = Object.fromEntries(
      Array.from({ length: DATABASE_COLUMN_MAX + 1 }, (_, index) => [
        `c${index}`,
        integerValue("1"),
      ])
    )
    expect(DatabaseInsertBodySchema.safeParse({ values: wide }).success).toBe(
      false
    )
  })

  it("refuses to write a blob column", () => {
    expect(
      DatabaseInsertBodySchema.safeParse({
        values: { payload: { type: "blob", base64: "QUJD" } },
      }).success
    ).toBe(false)
  })

  it("requires a key, an expected signature and at least one column to update", () => {
    const base = {
      key: [{ column: "id", value: integerValue("1") }],
      expectedSignature: "row-1",
    }
    expect(
      DatabaseUpdateBodySchema.safeParse({
        ...base,
        values: { title: { type: "text", value: "a" } },
      }).success
    ).toBe(true)
    expect(
      DatabaseUpdateBodySchema.safeParse({ ...base, values: {} }).success
    ).toBe(false)
    expect(
      DatabaseUpdateBodySchema.safeParse({
        key: base.key,
        values: { title: { type: "text", value: "a" } },
      }).success
    ).toBe(false)
    expect(
      DatabaseUpdateBodySchema.safeParse({
        expectedSignature: "row-1",
        values: { title: { type: "text", value: "a" } },
      }).success
    ).toBe(false)
  })

  it("reuses the same item shape for single and batch delete", () => {
    const item = {
      key: [{ column: "id", value: integerValue("1") }],
      expectedSignature: "row-1",
    }
    expect(DatabaseDeleteBodySchema.safeParse({ items: [item] }).success).toBe(
      true
    )
    expect(DatabaseDeleteBodySchema.safeParse({ items: [] }).success).toBe(
      false
    )
    expect(
      DatabaseDeleteBodySchema.safeParse({
        items: Array.from({ length: DATABASE_DELETE_MAX }, () => item),
      }).success
    ).toBe(true)
    expect(
      DatabaseDeleteBodySchema.safeParse({
        items: Array.from({ length: DATABASE_DELETE_MAX + 1 }, () => item),
      }).success
    ).toBe(false)
    // 定位信息必须完整，不能只给一个主键值就删
    expect(
      DatabaseDeleteBodySchema.safeParse({
        items: [{ key: item.key }],
      }).success
    ).toBe(false)
  })

  it("reports deleted, conflicted and failed items separately", () => {
    const key = [{ column: "id", value: integerValue("1") }]
    expect(
      DatabaseDeleteResultSchema.parse({
        deleted: [key],
        conflicts: [],
        failed: [{ key, message: "目标表只读" }],
      }).failed
    ).toHaveLength(1)
    expect(
      DatabaseDeleteResultSchema.safeParse({
        deleted: [key],
        conflicts: [],
        failed: [{ key }],
      }).success
    ).toBe(false)
  })
})
