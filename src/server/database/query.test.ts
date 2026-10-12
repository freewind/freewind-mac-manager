import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { DatabaseSync } from "node:sqlite"
import type {
  DatabaseFilter,
  DatabaseRecord,
  DatabaseSort,
} from "@shared/api-contract"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { closeDatabase, openDatabase } from "./connection"
import {
  getRecord,
  type ListRecordsInput,
  listRecords,
  type QueryLimits,
} from "./query"
import { DatabaseQueryError } from "./query-protocol"

const BIG_ID = "9007199254740993"

const DDL = `
CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  note TEXT DEFAULT NULL,
  price REAL,
  qty INTEGER NOT NULL DEFAULT 0,
  blob_col BLOB
);
CREATE TABLE "weird ok" ("id" INTEGER PRIMARY KEY, "a b" TEXT, "q""d" TEXT);
CREATE TABLE nopk (a TEXT);
CREATE TABLE composite (a TEXT NOT NULL, b INTEGER NOT NULL, label TEXT, PRIMARY KEY(a, b));
CREATE TABLE wide (id INTEGER PRIMARY KEY, big TEXT);
CREATE TABLE oversize (id INTEGER PRIMARY KEY, big TEXT);
CREATE VIEW v_items AS SELECT id, name FROM items;
`

const ITEMS = `
INSERT INTO items (id, name, note, price, qty, blob_col) VALUES
  (1, 'apple', NULL, 1.5, 10, x'414243'),
  (2, 'apricot', 'x', 2.5, 20, NULL),
  (3, 'banana', 'y', NULL, 30, NULL),
  (4, 'cherry', '', 3.5, 0, NULL),
  (5, 'date', 'z', 4.5, 40, NULL),
  (${BIG_ID}, 'big-int', NULL, 0, 1, NULL);
INSERT INTO "weird ok" VALUES (1, 'a b value', 'q"d value');
INSERT INTO nopk VALUES ('only');
INSERT INTO composite VALUES ('a1', 1, 'first'), ('a1', 2, 'second'), ('a2', 1, 'third');
INSERT INTO wide VALUES (1, '${"w".repeat(70 * 1024)}');
`

let dir: string
let file: string
let database: DatabaseSync

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-query-"))
  file = path.join(dir, "app.sqlite3")
  const setup = openDatabase({ file })
  setup.exec(DDL)
  setup.exec(ITEMS)
  const big = "b".repeat(60 * 1024)
  setup.exec("BEGIN")
  const insert = setup.prepare("INSERT INTO oversize (id, big) VALUES (?, ?)")
  for (let index = 1; index <= 40; index += 1) insert.run(index, big)
  setup.exec("COMMIT")
  setup.close()
  database = openDatabase({ file, mode: "readonly" })
})

afterEach(() => {
  closeDatabase(database)
  rmSync(dir, { recursive: true, force: true })
})

const list = (
  table: string,
  overrides: Partial<ListRecordsInput> = {},
  limits: QueryLimits = {}
) =>
  listRecords(
    database,
    { table, page: 1, pageSize: 50, filters: [], sorts: [], ...overrides },
    limits
  )

const idOf = (record: DatabaseRecord): string => {
  const value = record.values.id
  return value && value.type === "integer" ? value.value : ""
}

const idsOf = (records: DatabaseRecord[]): string[] => records.map(idOf)

const integer = (value: string) => ({ type: "integer" as const, value })
const text = (value: string) => ({ type: "text" as const, value })

const filter = (
  column: string,
  operator: DatabaseFilter["operator"],
  value?: DatabaseFilter["value"]
): DatabaseFilter => ({ column, operator, value })

const sort = (
  column: string,
  direction: DatabaseSort["direction"] = "asc"
): DatabaseSort => ({ column, direction })

const expectQueryError = (run: () => unknown, status: number): string => {
  let caught: unknown
  try {
    run()
  } catch (error) {
    caught = error
  }
  if (!(caught instanceof DatabaseQueryError)) {
    throw new Error(`应当抛出 DatabaseQueryError，实际：${String(caught)}`)
  }
  expect(caught.httpStatus).toBe(status)
  return caught.message
}

describe("listRecords filters", () => {
  it("supports every operator with bound values", () => {
    expect(
      idsOf(
        list("items", { filters: [filter("name", "eq", text("apple"))] })
          .records
      )
    ).toEqual(["1"])
    expect(
      idsOf(
        list("items", { filters: [filter("name", "startsWith", text("ap"))] })
          .records
      )
    ).toEqual(["1", "2"])
    expect(
      idsOf(
        list("items", { filters: [filter("name", "contains", text("an"))] })
          .records
      )
    ).toEqual(["3"])
    expect(
      idsOf(
        list("items", { filters: [filter("qty", "gt", integer("20"))] }).records
      )
    ).toEqual(["3", "5"])
    expect(
      idsOf(
        list("items", { filters: [filter("qty", "gte", integer("20"))] })
          .records
      )
    ).toEqual(["2", "3", "5"])
    expect(
      idsOf(
        list("items", { filters: [filter("qty", "lt", integer("20"))] }).records
      )
    ).toEqual(["1", "4", BIG_ID])
    expect(
      idsOf(
        list("items", { filters: [filter("qty", "lte", integer("20"))] })
          .records
      )
    ).toEqual(["1", "2", "4", BIG_ID])
    expect(
      idsOf(list("items", { filters: [filter("note", "isNull")] }).records)
    ).toEqual(["1", BIG_ID])
    expect(
      idsOf(list("items", { filters: [filter("note", "isNotNull")] }).records)
    ).toEqual(["2", "3", "4", "5"])
    // ne 与 eq 都按 SQL 语义处理 NULL，不能拿 = NULL 去比
    expect(
      idsOf(
        list("items", { filters: [filter("note", "eq", { type: "null" })] })
          .records
      )
    ).toEqual(["1", BIG_ID])
    expect(
      idsOf(
        list("items", { filters: [filter("note", "ne", { type: "null" })] })
          .records
      )
    ).toEqual(["2", "3", "4", "5"])
    expect(
      idsOf(
        list("items", { filters: [filter("name", "ne", text("apple"))] })
          .records
      )
    ).toEqual(["2", "3", "4", "5", BIG_ID])
  })

  it("combines several filters with AND", () => {
    expect(
      idsOf(
        list("items", {
          filters: [
            filter("name", "startsWith", text("a")),
            filter("qty", "gte", integer("20")),
          ],
        }).records
      )
    ).toEqual(["2"])
  })

  it("treats injection text as a literal value", () => {
    const injection = "'; DROP TABLE items; --"
    expect(
      list("items", { filters: [filter("name", "eq", text(injection))] })
        .records
    ).toEqual([])
    expect(list("items").total).toBe(6)
  })

  it("refuses filters that do not fit the operator", () => {
    expectQueryError(
      () =>
        list("items", { filters: [filter("name", "contains", integer("1"))] }),
      400
    )
    expectQueryError(
      () => list("items", { filters: [filter("name", "eq")] }),
      400
    )
  })
})

describe("listRecords ordering and paging", () => {
  it("orders by the primary key when no sort is given", () => {
    expect(idsOf(list("items").records)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      BIG_ID,
    ])
  })

  it("sorts and pages without overlap or gaps", () => {
    const first = list("items", { sorts: [sort("qty", "desc")], pageSize: 3 })
    const second = list("items", {
      sorts: [sort("qty", "desc")],
      pageSize: 3,
      page: 2,
    })
    expect(idsOf(first.records)).toEqual(["5", "3", "2"])
    expect(idsOf(second.records)).toEqual(["1", BIG_ID, "4"])
    expect(first.total).toBe(6)
    expect(first.pageSize).toBe(3)
  })

  it("appends the primary key so equal sort values stay stable", () => {
    const response = list("composite", { sorts: [sort("a")] })
    expect(response.records.map((record) => record.key)).toEqual([
      [
        { column: "a", value: text("a1") },
        { column: "b", value: integer("1") },
      ],
      [
        { column: "a", value: text("a1") },
        { column: "b", value: integer("2") },
      ],
      [
        { column: "a", value: text("a2") },
        { column: "b", value: integer("1") },
      ],
    ])
  })

  it("requires an explicit sort for tables without a primary key", () => {
    const message = expectQueryError(() => list("nopk"), 400)
    expect(message).toContain("没有主键")
    const response = list("nopk", { sorts: [sort("a")] })
    expect(response.records[0].key).toEqual([])
    expect(response.records[0].values.a).toEqual(text("only"))
  })

  it("reads a view with an empty record key", () => {
    const response = list("v_items", { sorts: [sort("id")] })
    expect(idsOf(response.records)).toEqual(["1", "2", "3", "4", "5", BIG_ID])
    expect(response.records[0].key).toEqual([])
  })
})

describe("listRecords values", () => {
  it("keeps big integers as decimal strings and blobs as base64", () => {
    const response = list("items", {
      filters: [filter("id", "eq", integer(BIG_ID))],
    })
    expect(response.records[0].values.id).toEqual(integer(BIG_ID))
    const apple = list("items", {
      filters: [filter("id", "eq", integer("1"))],
    })
    expect(apple.records[0].values.blob_col).toEqual({
      type: "blob",
      base64: "QUJD",
    })
    expect(apple.records[0].signature).toHaveLength(32)
  })

  it("does not truncate an oversized value", () => {
    const message = expectQueryError(() => list("wide"), 400)
    expect(message).toContain("列「big」")
    expect(message).toContain("超过单值上限")
  })

  it("rejects a response over the size limit", () => {
    expectQueryError(() => list("oversize"), 400)
    // 用小页 + 注入的上限来验证检查本身
    const message = expectQueryError(
      () => list("items", {}, { responseMaxBytes: 10 }),
      400
    )
    expect(message).toContain("MiB")
  })
})

describe("listRecords limits", () => {
  it("rejects out-of-range paging, filter and sort counts", () => {
    expectQueryError(() => list("items", { pageSize: 101 }), 400)
    expectQueryError(() => list("items", { pageSize: 0 }), 400)
    expectQueryError(() => list("items", { page: 0 }), 400)
    expectQueryError(() => list("items", { pageSize: 2.5 }), 400)
    expectQueryError(
      () =>
        list("items", {
          filters: Array.from({ length: 9 }, () => filter("name", "isNotNull")),
        }),
      400
    )
    expectQueryError(
      () =>
        list("items", {
          sorts: Array.from({ length: 5 }, () => sort("qty")),
        }),
      400
    )
  })

  it("rejects unknown tables and columns instead of guessing", () => {
    expectQueryError(() => list("no_such_table"), 404)
    expectQueryError(() => list("items; DROP TABLE items"), 404)
    expectQueryError(
      () => list("items", { filters: [filter("nope", "eq", integer("1"))] }),
      400
    )
    expectQueryError(
      () => list("items", { sorts: [sort('name" OR "1"="1')] }),
      400
    )
  })

  it("counts within a bound and reports null when it cannot", () => {
    expect(list("items").total).toBe(6)
    expect(
      list("items", { filters: [filter("qty", "gte", integer("20"))] }).total
    ).toBe(3)
    // 行上限越过：不能把「不知道」写成 0
    expect(list("items", {}, { countRowLimit: 2 }).total).toBeNull()
    // 时间预算越过：同样记 null
    expect(list("items", {}, { countBudgetMs: -1 }).total).toBeNull()
  })
})

describe("getRecord", () => {
  it("locates a single row by a composite primary key", () => {
    const response = getRecord(database, {
      table: "composite",
      key: [
        { column: "a", value: text("a1") },
        { column: "b", value: integer("2") },
      ],
    })
    expect(response.record.values.label).toEqual(text("second"))
    expect(response.record.signature).toHaveLength(32)
  })

  it("requires the complete primary key and a real row", () => {
    expectQueryError(
      () =>
        getRecord(database, {
          table: "composite",
          key: [{ column: "a", value: text("a1") }],
        }),
      400
    )
    expectQueryError(
      () =>
        getRecord(database, {
          table: "composite",
          key: [
            { column: "a", value: text("nope") },
            { column: "b", value: integer("1") },
          ],
        }),
      404
    )
    expectQueryError(
      () =>
        getRecord(database, {
          table: "nopk",
          key: [{ column: "a", value: text("only") }],
        }),
      400
    )
  })

  it("handles quoted and spaced column names", () => {
    const response = list("weird ok", {
      filters: [filter("a b", "contains", text("b value"))],
      sorts: [sort("a b", "desc")],
    })
    expect(response.records[0].values['q"d']).toEqual(text('q"d value'))
    expect(response.records[0].key).toEqual([
      { column: "id", value: integer("1") },
    ])
  })
})

describe("read-only guarantee", () => {
  it("leaves the data untouched and refuses writes", () => {
    const before = list("items").records
    list("items", { filters: [filter("name", "contains", text("a"))] })
    getRecord(database, {
      table: "items",
      key: [{ column: "id", value: integer("1") }],
    })
    expect(list("items").records).toEqual(before)
    expect(list("items").total).toBe(6)
    expect(() =>
      database.exec("INSERT INTO items (id, name) VALUES (99, 'x')")
    ).toThrow()
    expect(list("items").total).toBe(6)
  })
})
