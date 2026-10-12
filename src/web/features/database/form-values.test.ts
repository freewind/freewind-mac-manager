import type { DatabaseRecord, DatabaseTable } from "@shared/api-contract"
import { DATABASE_TEXT_MAX_LENGTH } from "@shared/api-contract"
import { describe, expect, it } from "vitest"
import {
  buildInsertValues,
  buildUpdateValues,
  changedColumns,
  emptyRecordForm,
  hasFormChanges,
  readOnlyColumnsOf,
  recordFormFromRecord,
  writableColumnsOf,
} from "./form-values"

const column = (
  name: string,
  affinity: DatabaseTable["columns"][number]["affinity"],
  extra: Partial<DatabaseTable["columns"][number]> = {}
): DatabaseTable["columns"][number] => ({
  name,
  declaredType: affinity.toUpperCase(),
  affinity,
  notNull: false,
  primaryKeyPosition: 0,
  generated: false,
  hidden: false,
  write: { allowed: true },
  ...extra,
})

const table: DatabaseTable = {
  name: "items",
  kind: "table",
  rowCount: null,
  capabilities: [
    { operation: "read", allowed: true },
    { operation: "insert", allowed: true },
    { operation: "update", allowed: true },
    { operation: "delete", allowed: true },
  ],
  columns: [
    column("id", "integer", { primaryKeyPosition: 1 }),
    column("name", "text", { notNull: true }),
    column("qty", "integer", {
      notNull: true,
      defaultValue: { type: "integer", value: "0" },
    }),
    column("note", "text"),
    column("price", "real"),
    column("amount", "numeric"),
    column("total", "integer", {
      generated: true,
      write: {
        allowed: false,
        reason: "generated",
        message: "生成列由数据库计算",
      },
    }),
    column("payload", "blob", {
      write: {
        allowed: false,
        reason: "blob_read_only",
        message: "首期 BLOB 只读",
      },
    }),
  ],
  constraints: { primaryKey: ["id"], unique: [], foreignKeys: [], checks: [] },
  signature: "sig",
  withoutRowId: false,
  triggers: [],
  referencedBy: [],
}

const compositeTable: DatabaseTable = {
  ...table,
  name: "composite",
  columns: [
    column("a", "text", { notNull: true, primaryKeyPosition: 1 }),
    column("b", "integer", { notNull: true, primaryKeyPosition: 2 }),
    column("label", "text"),
  ],
  constraints: {
    primaryKey: ["a", "b"],
    unique: [],
    foreignKeys: [],
    checks: [],
  },
}

const record: DatabaseRecord = {
  key: [{ column: "id", value: { type: "integer", value: "7" } }],
  values: {
    id: { type: "integer", value: "7" },
    name: { type: "text", value: "apple" },
    qty: { type: "integer", value: "3" },
    note: { type: "null" },
    price: { type: "real", value: 1.5 },
    amount: { type: "text", value: "7" },
    total: { type: "integer", value: "6" },
    payload: { type: "blob", base64: "QUJD" },
  },
  signature: "row-sig",
}

describe("字段划分", () => {
  it("只把可写字段放进表单，生成列与 BLOB 列只读展示", () => {
    expect(writableColumnsOf(table).map((item) => item.name)).toEqual([
      "id",
      "name",
      "qty",
      "note",
      "price",
      "amount",
    ])
    expect(readOnlyColumnsOf(table).map((item) => item.name)).toEqual([
      "total",
      "payload",
    ])
  })
})

describe("emptyRecordForm", () => {
  it("有默认值的列省略，INTEGER 主键交给数据库生成", () => {
    const form = emptyRecordForm(table)
    expect(form.qty).toEqual({ mode: "omit", text: "" })
    expect(form.id).toEqual({ mode: "omit", text: "" })
  })

  it("非空列留空等用户填，可空列默认 NULL", () => {
    const form = emptyRecordForm(table)
    expect(form.name).toEqual({ mode: "value", text: "" })
    expect(form.note).toEqual({ mode: "null", text: "" })
  })

  it("复合主键的列必须填写，不能省略", () => {
    const form = emptyRecordForm(compositeTable)
    expect(form.a).toEqual({ mode: "value", text: "" })
    expect(form.b).toEqual({ mode: "value", text: "" })
  })
})

describe("recordFormFromRecord", () => {
  it("按记录回填，NULL 与空串分开", () => {
    const form = recordFormFromRecord(table, record)
    expect(form.note).toEqual({ mode: "null", text: "" })
    expect(form.name).toEqual({ mode: "value", text: "apple" })
    expect(form.qty).toEqual({ mode: "value", text: "3" })
    expect(form.price).toEqual({ mode: "value", text: "1.5" })
    // 文本列里存着 "7" 也要原样回填，不因为看起来像数字就换类型
    expect(form.amount).toEqual({ mode: "value", text: "7" })

    const emptyText: DatabaseRecord = {
      ...record,
      values: { ...record.values, name: { type: "text", value: "" } },
    }
    expect(recordFormFromRecord(table, emptyText).name).toEqual({
      mode: "value",
      text: "",
    })
  })
})

describe("buildInsertValues", () => {
  it("省略的列不进请求，显式 NULL 与空串分别提交", () => {
    const form = emptyRecordForm(table)
    const result = buildInsertValues(table, {
      ...form,
      name: { mode: "value", text: "" },
      note: { mode: "null", text: "" },
      price: { mode: "value", text: "1.5" },
      amount: { mode: "omit", text: "" },
    })
    expect(result.errors).toEqual({})
    // qty 与 id 省略：交给数据库默认值
    expect(result.values).toEqual({
      name: { type: "text", value: "" },
      note: { type: "null" },
      price: { type: "real", value: 1.5 },
    })
    expect("qty" in result.values).toBe(false)
    expect("id" in result.values).toBe(false)
  })

  it("整数用十进制字符串，大整数不丢精度", () => {
    const form = emptyRecordForm(table)
    const result = buildInsertValues(table, {
      ...form,
      name: { mode: "value", text: "big" },
      id: { mode: "value", text: "9007199254740993" },
    })
    expect(result.values.id).toEqual({
      type: "integer",
      value: "9007199254740993",
    })
  })

  it("超出 int64 的十进制串按 SQLite 行为存成实数", () => {
    const form = emptyRecordForm(table)
    const result = buildInsertValues(table, {
      ...form,
      name: { mode: "value", text: "huge" },
      id: { mode: "value", text: "99999999999999999999" },
    })
    expect(result.values.id?.type).toBe("real")
  })

  it("不按声明类型假装业务 schema：识别不了的值按文本原样提交", () => {
    const form = emptyRecordForm(table)
    const result = buildInsertValues(table, {
      ...form,
      name: { mode: "value", text: "abc" },
      id: { mode: "value", text: "12a" },
      price: { mode: "value", text: "not-a-number" },
      amount: { mode: "value", text: "混合值" },
    })
    expect(result.errors).toEqual({})
    expect(result.values.id).toEqual({ type: "text", value: "12a" })
    expect(result.values.price).toEqual({
      type: "text",
      value: "not-a-number",
    })
    expect(result.values.amount).toEqual({ type: "text", value: "混合值" })
  })

  it("混合存储类型能识别就按识别结果", () => {
    const form = emptyRecordForm(table)
    const integer = buildInsertValues(table, {
      ...form,
      name: { mode: "value", text: "a" },
      amount: { mode: "value", text: "7" },
    })
    expect(integer.values.amount).toEqual({ type: "integer", value: "7" })
    const real = buildInsertValues(table, {
      ...form,
      name: { mode: "value", text: "a" },
      amount: { mode: "value", text: "1.5" },
    })
    expect(real.values.amount).toEqual({ type: "real", value: 1.5 })
  })

  it("超长文本给出字段级错误，只读列根本不进提交", () => {
    const form = emptyRecordForm(table)
    const long = buildInsertValues(table, {
      ...form,
      name: { mode: "value", text: "a".repeat(DATABASE_TEXT_MAX_LENGTH + 1) },
    })
    expect(Object.keys(long.errors)).toEqual(["name"])
    expect(long.errors.name).toContain("超过单值上限")

    // BLOB 列不可写：表单里不会出现它，提交时也不会带上它
    const blob = buildInsertValues(table, {
      ...form,
      name: { mode: "value", text: "a" },
      payload: { mode: "value", text: "x" },
    })
    expect(blob.errors).toEqual({})
    expect("payload" in blob.values).toBe(false)
  })
})

describe("buildUpdateValues", () => {
  it("只提交变化过的字段", () => {
    const initial = recordFormFromRecord(table, record)
    const result = buildUpdateValues(table, initial, {
      ...initial,
      qty: { mode: "value", text: "9" },
    })
    expect(result.values).toEqual({ qty: { type: "integer", value: "9" } })
  })

  it("没动过的字段不提交，即使文本看起来能换类型", () => {
    const initial = recordFormFromRecord(table, record)
    const result = buildUpdateValues(table, initial, { ...initial })
    expect(result.values).toEqual({})
    expect(hasFormChanges(initial, { ...initial })).toBe(false)
  })

  it("NULL 与值之间的切换算变化", () => {
    const initial = recordFormFromRecord(table, record)
    expect(
      buildUpdateValues(table, initial, {
        ...initial,
        note: { mode: "value", text: "写点东西" },
      }).values
    ).toEqual({ note: { type: "text", value: "写点东西" } })
    expect(
      buildUpdateValues(table, initial, {
        ...initial,
        name: { mode: "null", text: "" },
      }).values
    ).toEqual({ name: { type: "null" } })
  })

  it("变化列表只包含真正改动的列", () => {
    const initial = recordFormFromRecord(table, record)
    expect(
      changedColumns(initial, {
        ...initial,
        qty: { mode: "value", text: "9" },
        note: { mode: "null", text: "" },
      })
    ).toEqual(["qty"])
  })
})
