import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { DatabaseSync } from "node:sqlite"
import type { DatabaseTable } from "@shared/api-contract"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { closeDatabase, openDatabase } from "./connection"
import {
  affinityOf,
  getTable,
  listTables,
  parseDefaultValue,
  requireTable,
} from "./metadata"
import { DatabaseQueryError } from "./query-protocol"

/**
 * 测试库覆盖：普通主键表、无主键表、可空主键、复合主键、WITHOUT ROWID、
 * 生成列、唯一索引、外键、触发器、视图、fts5 虚拟表、奇异表列名。
 */
const DDL = `
CREATE TABLE plain (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  note TEXT DEFAULT NULL,
  amount REAL DEFAULT 1.5,
  tag TEXT DEFAULT 'x',
  total INTEGER GENERATED ALWAYS AS (length(name)) STORED
);
CREATE TABLE nopk (a TEXT);
CREATE TABLE nullable_pk (a TEXT PRIMARY KEY, b TEXT);
CREATE TABLE composite (a TEXT NOT NULL, b INTEGER NOT NULL, PRIMARY KEY(a, b));
CREATE TABLE wor (a TEXT, b INTEGER, PRIMARY KEY(a)) WITHOUT ROWID;
CREATE TABLE desc_pk (id INTEGER PRIMARY KEY DESC, v TEXT);
CREATE TABLE "weird ok" ("id" INTEGER PRIMARY KEY, "a b" TEXT);
CREATE TABLE weird ("select" TEXT PRIMARY KEY, "a b" TEXT, "q""d" TEXT, "café" TEXT);
CREATE UNIQUE INDEX uq_plain_name ON plain(name);
CREATE INDEX idx_plain_note ON plain(note);
CREATE TABLE parent_implicit (id INTEGER PRIMARY KEY);
CREATE TABLE child (
  id INTEGER PRIMARY KEY,
  plain_id INTEGER REFERENCES plain(id) ON DELETE CASCADE ON UPDATE SET NULL
);
CREATE TABLE child_implicit (
  id INTEGER PRIMARY KEY,
  ref INTEGER REFERENCES parent_implicit
);
CREATE TRIGGER trg_plain AFTER INSERT ON plain BEGIN SELECT 1; END;
CREATE VIEW v_plain AS SELECT id, name FROM plain;
CREATE VIRTUAL TABLE docs USING fts5(body);
`

let dir: string
let file: string
let database: DatabaseSync

beforeEach(() => {
  // 只用临时库，绝不碰真实记录
  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-metadata-"))
  file = path.join(dir, "app.sqlite3")
  const setup = openDatabase({ file })
  setup.exec(DDL)
  setup.close()
  database = openDatabase({ file, mode: "readonly" })
})

afterEach(() => {
  closeDatabase(database)
  rmSync(dir, { recursive: true, force: true })
})

const table = (name: string): DatabaseTable => {
  const detail = getTable(database, name)
  if (!detail) throw new Error(`表 ${name} 不存在`)
  return detail
}

const capability = (detail: DatabaseTable, operation: string) =>
  detail.capabilities.find((item) => item.operation === operation)

const column = (detail: DatabaseTable, name: string) =>
  detail.columns.find((item) => item.name === name)

const disabledReason = (detail: DatabaseTable): string | undefined => {
  const update = capability(detail, "update")
  return update && !update.allowed ? update.reason : undefined
}

describe("affinityOf", () => {
  it("follows the SQLite affinity rules in order", () => {
    expect(affinityOf("INT")).toBe("integer")
    expect(affinityOf("BIGINT")).toBe("integer")
    expect(affinityOf("VARCHAR(20)")).toBe("text")
    expect(affinityOf("CLOB")).toBe("text")
    expect(affinityOf("")).toBe("blob")
    expect(affinityOf("BLOB")).toBe("blob")
    expect(affinityOf("DOUBLE")).toBe("real")
    expect(affinityOf("FLOAT")).toBe("real")
    expect(affinityOf("DECIMAL(10,2)")).toBe("numeric")
    expect(affinityOf("BOOLEAN")).toBe("numeric")
  })
})

describe("parseDefaultValue", () => {
  it("distinguishes no default, explicit NULL and literal values", () => {
    expect(parseDefaultValue(null)).toBeUndefined()
    expect(parseDefaultValue("NULL")).toEqual({ type: "null" })
    expect(parseDefaultValue("0")).toEqual({ type: "integer", value: "0" })
    expect(parseDefaultValue("1.5")).toEqual({ type: "real", value: 1.5 })
    expect(parseDefaultValue("'a''b'")).toEqual({
      type: "text",
      value: "a'b",
    })
    expect(parseDefaultValue("CURRENT_TIMESTAMP")).toEqual({
      type: "text",
      value: "CURRENT_TIMESTAMP",
    })
    // 超出 int64 的字面量按原文展示，不能悄悄变成不精确的 number
    expect(parseDefaultValue("99999999999999999999")).toEqual({
      type: "text",
      value: "99999999999999999999",
    })
  })
})

describe("listTables", () => {
  it("discovers a table created after the first listing without restarting", () => {
    expect(listTables(database).map((item) => item.name)).toContain("plain")
    const writer = openDatabase({ file })
    writer.exec("CREATE TABLE later_table (id INTEGER PRIMARY KEY)")
    writer.close()
    expect(listTables(database).map((item) => item.name)).toContain(
      "later_table"
    )
  })

  it("never counts rows in the table list", () => {
    for (const summary of listTables(database)) {
      expect(summary.rowCount).toBeNull()
    }
  })

  it("reports all four operations for every listed table", () => {
    for (const summary of listTables(database)) {
      expect(summary.capabilities.map((item) => item.operation).sort()).toEqual(
        ["delete", "insert", "read", "update"]
      )
    }
  })
})

describe("getTable capabilities", () => {
  it("allows writes only with an explicit reliable non-null primary key", () => {
    for (const name of ["plain", "composite", "wor", "weird ok"]) {
      const detail = table(name)
      expect([
        capability(detail, "insert")?.allowed,
        capability(detail, "update")?.allowed,
        capability(detail, "delete")?.allowed,
      ]).toEqual([true, true, true])
    }
  })

  it("keeps tables without a reliable primary key read-only", () => {
    // 没有主键、可空主键、INTEGER PRIMARY KEY DESC 都不是可靠定位
    expect(disabledReason(table("nopk"))).toBe("no_primary_key")
    expect(disabledReason(table("nullable_pk"))).toBe("no_primary_key")
    expect(disabledReason(table("desc_pk"))).toBe("no_primary_key")
    expect(disabledReason(table("weird"))).toBe("no_primary_key")
    // 读取仍然允许
    expect(capability(table("nopk"), "read")?.allowed).toBe(true)
  })

  it("never pretends the hidden rowid is a primary key", () => {
    const detail = table("nopk")
    expect(detail.constraints.primaryKey).toEqual([])
    expect(
      detail.capabilities.find((item) => item.operation === "delete")
    ).toMatchInlineSnapshot(`
        {
          "allowed": false,
          "message": "没有显式可靠的非空唯一主键，无法安全定位单条记录，只读",
          "operation": "delete",
          "reason": "no_primary_key",
        }
      `)
  })

  it("marks views, virtual tables, shadow tables and system tables read-only with a reason", () => {
    expect(disabledReason(table("v_plain"))).toBe("view")
    expect(disabledReason(table("docs"))).toBe("virtual_table")
    expect(disabledReason(table("docs_config"))).toBe("shadow_table")
    expect(disabledReason(table("sqlite_schema"))).toBe("system_table")
    const update = capability(table("docs"), "update")
    expect(update && !update.allowed ? update.message : "").toContain("fts5")
  })
})

describe("getTable structure", () => {
  it("reads column types, affinity, not null, generated and hidden flags", () => {
    const detail = table("plain")
    expect(detail.kind).toBe("table")
    expect(detail.withoutRowId).toBe(false)
    expect(column(detail, "id")).toMatchInlineSnapshot(`
      {
        "affinity": "integer",
        "declaredType": "INTEGER",
        "generated": false,
        "hidden": false,
        "name": "id",
        "notNull": false,
        "primaryKeyPosition": 1,
        "write": {
          "allowed": true,
        },
      }
    `)
    expect(column(detail, "name")?.notNull).toBe(true)
    expect(column(detail, "total")?.generated).toBe(true)
    expect(column(detail, "total")?.write).toEqual({
      allowed: false,
      reason: "generated",
      message: "生成列由数据库计算，不能写入",
    })
  })

  it("keeps an omitted default apart from an explicit NULL default", () => {
    const detail = table("plain")
    expect("defaultValue" in (column(detail, "id") ?? {})).toBe(false)
    expect(column(detail, "note")?.defaultValue).toEqual({ type: "null" })
    expect(column(detail, "tag")?.defaultValue).toEqual({
      type: "text",
      value: "x",
    })
    expect(column(detail, "amount")?.defaultValue).toEqual({
      type: "real",
      value: 1.5,
    })
  })

  it("reports composite primary key positions in order", () => {
    const detail = table("composite")
    expect(detail.constraints.primaryKey).toEqual(["a", "b"])
    expect(column(detail, "a")?.primaryKeyPosition).toBe(1)
    expect(column(detail, "b")?.primaryKeyPosition).toBe(2)
    expect(table("wor").withoutRowId).toBe(true)
  })

  it("collects unique constraints, foreign keys and triggers", () => {
    const detail = table("plain")
    expect(detail.constraints.unique).toEqual([
      { name: "uq_plain_name", columns: ["name"] },
    ])
    expect(detail.triggers).toEqual(["trg_plain"])

    const child = table("child")
    expect(child.constraints.foreignKeys).toEqual([
      {
        id: 0,
        columns: ["plain_id"],
        referencedTable: "plain",
        referencedColumns: ["id"],
        onDelete: "CASCADE",
        onUpdate: "SET NULL",
      },
    ])
    // 没写引用列时补全成父表主键，不能留空
    expect(
      table("child_implicit").constraints.foreignKeys[0].referencedColumns
    ).toEqual(["id"])
  })

  it("handles quoted, spaced and non-ASCII names", () => {
    const detail = table("weird ok")
    expect(detail.columns.map((item) => item.name)).toEqual(["id", "a b"])
    const quoted = table("weird")
    expect(quoted.columns.map((item) => item.name)).toEqual([
      "select",
      "a b",
      'q"d',
      "café",
    ])
    expect(quoted.constraints.primaryKey).toEqual(["select"])
  })

  it("keeps the structure signature stable and changes it with the schema", () => {
    const before = table("plain").signature
    expect(table("plain").signature).toBe(before)
    const writer = openDatabase({ file })
    writer.exec("ALTER TABLE plain ADD COLUMN extra TEXT")
    writer.close()
    expect(table("plain").signature).not.toBe(before)
  })

  it("returns null for an unknown table and throws a 404 from requireTable", () => {
    expect(getTable(database, "no_such_table")).toBeNull()
    expect(() => requireTable(database, "no_such_table")).toThrow(
      DatabaseQueryError
    )
    try {
      requireTable(database, "no_such_table")
    } catch (error) {
      expect((error as DatabaseQueryError).httpStatus).toBe(404)
    }
  })
})
