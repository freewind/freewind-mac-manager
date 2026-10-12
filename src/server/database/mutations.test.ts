import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import type { DatabaseRecord } from "@shared/api-contract"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { closeDatabase, openDatabase } from "./connection"
import { DatabaseMutationError } from "./mutation-protocol"
import { deleteRecords, insertRecord, updateRecord } from "./mutations"
import { getRecord } from "./query"

const WIDE_COLUMN_COUNT = 40
const WIDE_VALUE = "w".repeat(60 * 1024)

const DDL = `
CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  qty INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  note TEXT DEFAULT NULL,
  tag TEXT NOT NULL DEFAULT 'none',
  payload BLOB,
  total INTEGER GENERATED ALWAYS AS (qty * 2) STORED
);
CREATE TABLE defaults_only (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT 'x');
CREATE TABLE composite (a TEXT NOT NULL, b INTEGER NOT NULL, label TEXT, PRIMARY KEY(a, b));
CREATE TABLE wor (a TEXT NOT NULL, b INTEGER NOT NULL, note TEXT, PRIMARY KEY(a)) WITHOUT ROWID;
CREATE TABLE nopk (a TEXT);
CREATE TABLE nullable_pk (a TEXT PRIMARY KEY, b TEXT);
CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE child (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER NOT NULL REFERENCES parent(id),
  note TEXT
);
CREATE TABLE cascader (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER REFERENCES parent(id) ON DELETE CASCADE
);
CREATE TABLE triggered (id INTEGER PRIMARY KEY, name TEXT);
CREATE TRIGGER trg_triggered BEFORE INSERT ON triggered
BEGIN SELECT RAISE(ABORT, '自定义拒绝'); END;
CREATE VIEW v_items AS SELECT id, name FROM items;
INSERT INTO parent (id, name) VALUES (1, 'p1'), (2, 'p2');
`

let dir: string
let file: string
let database: DatabaseSync

const text = (value: string) => ({ type: "text" as const, value })
const integer = (value: string) => ({ type: "integer" as const, value })
const nullValue = { type: "null" as const }

const expectMutationError = (
  run: () => unknown,
  status: number,
  executionStatus = "not_started"
): string => {
  let caught: unknown
  try {
    run()
  } catch (error) {
    caught = error
  }
  if (!(caught instanceof DatabaseMutationError)) {
    throw new Error(`应当抛出 DatabaseMutationError，实际：${String(caught)}`)
  }
  expect(caught.httpStatus).toBe(status)
  expect(caught.executionStatus).toBe(executionStatus)
  return caught.message
}

const countRows = (table: string): number =>
  Number(
    (
      database.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {
        n: bigint
      }
    ).n
  )

const itemById = (id: string): DatabaseRecord =>
  getRecord(database, {
    table: "items",
    key: [{ column: "id", value: integer(id) }],
  }).record

const idOf = (record: DatabaseRecord): string => {
  const value = record.values.id
  return value && value.type === "integer" ? value.value : ""
}

const insertItem = (name: string) =>
  insertRecord(database, { table: "items", values: { name: text(name) } })

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-mutations-"))
  file = path.join(dir, "app.sqlite3")
  const setup = openDatabase({ file })
  setup.exec(DDL)
  const wideColumns = Array.from(
    { length: WIDE_COLUMN_COUNT },
    (_, index) => `c${index} TEXT`
  ).join(", ")
  setup.exec(`CREATE TABLE wide_write (id INTEGER PRIMARY KEY, ${wideColumns})`)
  setup.exec("INSERT INTO items (name, qty) VALUES ('seed', 1)")
  setup.close()
  database = openDatabase({ file })
})

afterEach(() => {
  closeDatabase(database)
  rmSync(dir, { recursive: true, force: true })
})

describe("insertRecord", () => {
  it("fills database defaults, computes generated columns and reads the row back", () => {
    const response = insertItem("apple")
    expect(response.table).toBe("items")
    expect(response.record.values.name).toEqual(text("apple"))
    // 省略的列交给数据库默认值
    expect(response.record.values.qty).toEqual(integer("0"))
    expect(response.record.values.tag).toEqual(text("none"))
    expect(response.record.values.note).toEqual(nullValue)
    // 生成列由数据库算出，也要能回读
    expect(response.record.values.total).toEqual(integer("0"))
    // 主键由数据库分配，并且能按它回读
    expect(response.record.key[0].column).toBe("id")
    expect(itemById(idOf(response.record))).toEqual(response.record)
  })

  it("keeps an omitted column apart from an explicit NULL", () => {
    const inserted = insertRecord(database, {
      table: "items",
      values: { name: text("apricot"), note: nullValue },
    })
    expect(inserted.record.values.note).toEqual(nullValue)
    expect(inserted.record.values.tag).toEqual(text("none"))
    // 显式 NULL 打到 NOT NULL 列：约束冲突，不是「省略」
    expectMutationError(
      () =>
        insertRecord(database, {
          table: "items",
          values: { name: text("banana"), tag: nullValue },
        }),
      409
    )
  })

  it("supports an all-defaults insert", () => {
    const response = insertRecord(database, {
      table: "defaults_only",
      values: {},
    })
    expect(response.record.values.name).toEqual(text("x"))
  })

  it("keeps big integers exact", () => {
    const response = insertRecord(database, {
      table: "items",
      values: { id: integer("9007199254740993"), name: text("big") },
    })
    expect(response.record.values.id).toEqual(integer("9007199254740993"))
    expect(itemById("9007199254740993").values.name).toEqual(text("big"))
  })

  it("writes composite and WITHOUT ROWID tables", () => {
    const composite = insertRecord(database, {
      table: "composite",
      values: { a: text("a1"), b: integer("1"), label: text("first") },
    })
    expect(composite.record.key).toEqual([
      { column: "a", value: text("a1") },
      { column: "b", value: integer("1") },
    ])
    const updated = updateRecord(database, {
      table: "composite",
      key: composite.record.key,
      expectedSignature: composite.record.signature,
      values: { label: text("second") },
    })
    expect(updated.record.values.label).toEqual(text("second"))
    const deleted = deleteRecords(database, {
      table: "composite",
      items: [
        {
          key: updated.record.key,
          expectedSignature: updated.record.signature,
        },
      ],
    })
    expect(deleted.deleted).toEqual([updated.record.key])
    expect(countRows("composite")).toBe(0)

    const wor = insertRecord(database, {
      table: "wor",
      values: { a: text("k"), b: integer("2"), note: text("n") },
    })
    expect(wor.record.values.note).toEqual(text("n"))
    expect(
      deleteRecords(database, {
        table: "wor",
        items: [
          { key: wor.record.key, expectedSignature: wor.record.signature },
        ],
      }).deleted
    ).toHaveLength(1)
    expect(countRows("wor")).toBe(0)
  })

  it("refuses read-only targets and unreliable primary keys", () => {
    for (const table of ["nopk", "nullable_pk", "v_items", "sqlite_schema"]) {
      expectMutationError(
        () => insertRecord(database, { table, values: { a: text("x") } }),
        403
      )
    }
    expectMutationError(
      () => insertRecord(database, { table: "missing", values: {} }),
      404
    )
  })

  it("refuses generated, hidden, blob and unknown columns", () => {
    expectMutationError(
      () =>
        insertRecord(database, {
          table: "items",
          values: { name: text("a"), total: integer("5") },
        }),
      400
    )
    expectMutationError(
      () =>
        insertRecord(database, {
          table: "items",
          values: { name: text("a"), payload: text("x") },
        }),
      400
    )
    expectMutationError(
      () =>
        insertRecord(database, {
          table: "items",
          values: { name: text("a"), nope: text("x") },
        }),
      400
    )
    expect(countRows("items")).toBe(1)
  })

  it("rejects a value over the single-value limit before writing", () => {
    expectMutationError(
      () =>
        insertRecord(database, {
          table: "items",
          values: { name: text("a".repeat(70 * 1024)) },
        }),
      400
    )
    expect(countRows("items")).toBe(1)
  })

  it("rejects a response over the size limit and rolls back", () => {
    const values = Object.fromEntries(
      Array.from({ length: WIDE_COLUMN_COUNT }, (_, index) => [
        `c${index}`,
        text(WIDE_VALUE),
      ])
    )
    const message = expectMutationError(
      () => insertRecord(database, { table: "wide_write", values }),
      400
    )
    expect(message).toContain("MiB")
    // 提交前就拒绝：不能留下写了一半的记录
    expect(countRows("wide_write")).toBe(0)
  })
})

describe("updateRecord", () => {
  it("changes only the given columns", () => {
    const created = insertItem("apple")
    const updated = updateRecord(database, {
      table: "items",
      key: created.record.key,
      expectedSignature: created.record.signature,
      values: { qty: integer("5") },
    })
    expect(updated.record.values.qty).toEqual(integer("5"))
    expect(updated.record.values.name).toEqual(text("apple"))
    expect(updated.record.values.total).toEqual(integer("10"))
    expect(updated.record.signature).not.toBe(created.record.signature)
    expect(itemById(idOf(created.record)).signature).toBe(
      updated.record.signature
    )
  })

  it("refuses an empty patch and forbidden columns", () => {
    const created = insertItem("apple")
    const base = {
      table: "items",
      key: created.record.key,
      expectedSignature: created.record.signature,
    }
    expectMutationError(
      () => updateRecord(database, { ...base, values: {} }),
      400
    )
    expectMutationError(
      () => updateRecord(database, { ...base, values: { id: integer("9") } }),
      400
    )
    expectMutationError(
      () =>
        updateRecord(database, { ...base, values: { total: integer("1") } }),
      400
    )
    expectMutationError(
      () => updateRecord(database, { ...base, values: { payload: text("x") } }),
      400
    )
    expectMutationError(
      () => updateRecord(database, { ...base, values: { nope: text("x") } }),
      400
    )
    expect(itemById(idOf(created.record)).values.qty).toEqual(integer("0"))
  })

  it("requires the complete primary key", () => {
    expectMutationError(
      () =>
        updateRecord(database, {
          table: "items",
          key: [],
          expectedSignature: "x",
          values: { qty: integer("1") },
        }),
      400
    )
    expectMutationError(
      () =>
        updateRecord(database, {
          table: "items",
          key: [{ column: "name", value: text("seed") }],
          expectedSignature: "x",
          values: { qty: integer("1") },
        }),
      400
    )
    expectMutationError(
      () =>
        updateRecord(database, {
          table: "items",
          key: [
            { column: "id", value: integer("1") },
            { column: "id", value: integer("2") },
          ],
          expectedSignature: "x",
          values: { qty: integer("1") },
        }),
      400
    )
  })

  it("rejects a stale signature without touching the row", () => {
    const created = insertItem("apple")
    const other = openDatabase({ file })
    other
      .prepare("UPDATE items SET qty = ? WHERE id = ?")
      .run(99n, idOf(created.record))
    other.close()

    const message = expectMutationError(
      () =>
        updateRecord(database, {
          table: "items",
          key: created.record.key,
          expectedSignature: created.record.signature,
          values: { qty: integer("1") },
        }),
      409
    )
    expect(message).toContain("记录已变化")
    expect(itemById(idOf(created.record)).values.qty).toEqual(integer("99"))
  })

  it("rejects a record that disappeared", () => {
    const created = insertItem("apple")
    const other = openDatabase({ file })
    other.prepare("DELETE FROM items WHERE id = ?").run(idOf(created.record))
    other.close()
    expectMutationError(
      () =>
        updateRecord(database, {
          table: "items",
          key: created.record.key,
          expectedSignature: created.record.signature,
          values: { qty: integer("1") },
        }),
      404
    )
  })

  it("rejects an old signature after the structure changed", () => {
    const created = insertItem("apple")
    const other = openDatabase({ file })
    other.exec("ALTER TABLE items ADD COLUMN extra TEXT")
    other.close()
    // 可见列集合变了：旧签名不再代表当前整行
    expectMutationError(
      () =>
        updateRecord(database, {
          table: "items",
          key: created.record.key,
          expectedSignature: created.record.signature,
          values: { qty: integer("1") },
        }),
      409
    )
  })
})

describe("deleteRecords", () => {
  it("deletes one record and reports the deleted keys", () => {
    const created = insertItem("apple")
    const result = deleteRecords(database, {
      table: "items",
      items: [
        {
          key: created.record.key,
          expectedSignature: created.record.signature,
        },
      ],
    })
    expect(result).toEqual({
      deleted: [created.record.key],
      conflicts: [],
      failed: [],
    })
    expect(countRows("items")).toBe(1)
  })

  it("rolls the whole batch back when one target conflicts", () => {
    const first = insertItem("apple")
    const second = insertItem("apricot")
    const third = insertItem("banana")
    const other = openDatabase({ file })
    other
      .prepare("UPDATE items SET qty = ? WHERE id = ?")
      .run(7n, idOf(third.record))
    other.close()

    const message = expectMutationError(
      () =>
        deleteRecords(database, {
          table: "items",
          items: [
            {
              key: first.record.key,
              expectedSignature: first.record.signature,
            },
            {
              key: second.record.key,
              expectedSignature: second.record.signature,
            },
            {
              key: third.record.key,
              expectedSignature: third.record.signature,
            },
          ],
        }),
      409
    )
    expect(message).toContain("第 3 条")
    // 全成功或全回滚：前面的两条也不能被删掉
    expect(countRows("items")).toBe(4)
  })

  it("rolls back when a target is missing", () => {
    const first = insertItem("apple")
    const second = insertItem("apricot")
    const other = openDatabase({ file })
    other.prepare("DELETE FROM items WHERE id = ?").run(idOf(second.record))
    other.close()
    expectMutationError(
      () =>
        deleteRecords(database, {
          table: "items",
          items: [
            {
              key: first.record.key,
              expectedSignature: first.record.signature,
            },
            {
              key: second.record.key,
              expectedSignature: second.record.signature,
            },
          ],
        }),
      404
    )
    // 第二条已经被别人删掉，剩下的第一条也不能删（全回滚）
    expect(countRows("items")).toBe(2)
  })

  it("refuses duplicate targets and oversized batches", () => {
    const created = insertItem("apple")
    const item = {
      key: created.record.key,
      expectedSignature: created.record.signature,
    }
    const message = expectMutationError(
      () => deleteRecords(database, { table: "items", items: [item, item] }),
      400
    )
    expect(message).toContain("重复")
    expectMutationError(
      () =>
        deleteRecords(database, {
          table: "items",
          items: Array.from({ length: 101 }, () => item),
        }),
      400
    )
    expect(countRows("items")).toBe(2)
  })

  it("refuses read-only tables", () => {
    expectMutationError(
      () =>
        deleteRecords(database, {
          table: "nopk",
          items: [
            {
              key: [{ column: "a", value: text("x") }],
              expectedSignature: "s",
            },
          ],
        }),
      403
    )
  })
})

describe("database error classification", () => {
  it("maps constraints to 409 without leaking values", () => {
    insertItem("apple")
    const unique = expectMutationError(() => insertItem("apple"), 409)
    expect(unique).toContain("唯一约束")
    expect(unique).toContain("items.name")
    // 错误里不能出现被写入的原值
    expect(unique).not.toContain("apple")

    const created = insertItem("apricot")
    const base = {
      table: "items",
      key: created.record.key,
      expectedSignature: created.record.signature,
    }
    expect(
      expectMutationError(
        () =>
          updateRecord(database, { ...base, values: { qty: integer("-1") } }),
        409
      )
    ).toContain("CHECK")
    expect(
      expectMutationError(
        () =>
          insertRecord(database, {
            table: "child",
            values: { parent_id: integer("999") },
          }),
        409
      )
    ).toContain("外键约束")
    expect(
      expectMutationError(
        () => insertRecord(database, { table: "triggered", values: {} }),
        409
      )
    ).toBe("触发器拒绝了写入")
    expect(
      expectMutationError(
        () =>
          insertRecord(database, {
            table: "items",
            values: { id: integer("1"), name: text("dup") },
          }),
        409
      )
    ).toContain("主键约束")
  })

  it("maps a locked database to 409", () => {
    // 用一个短锁等待的连接，避免测试真的等 5 秒
    const shortWait = new DatabaseSync(file, {
      readBigInts: true,
      timeout: 50,
    })
    const locker = openDatabase({ file })
    locker.exec("BEGIN IMMEDIATE")
    locker.prepare("INSERT INTO parent (id, name) VALUES (?, ?)").run(77n, "x")
    try {
      expectMutationError(
        () =>
          insertRecord(shortWait, {
            table: "parent",
            values: { name: text("blocked") },
          }),
        409
      )
    } finally {
      locker.exec("ROLLBACK")
      closeDatabase(locker)
      closeDatabase(shortWait)
    }
    expect(countRows("parent")).toBe(2)
  })

  it("maps a read-only connection to 403", () => {
    const readOnly = openDatabase({ file, mode: "readonly" })
    try {
      expectMutationError(
        () =>
          insertRecord(readOnly, {
            table: "items",
            values: { name: text("nope") },
          }),
        403
      )
    } finally {
      closeDatabase(readOnly)
    }
  })
})

describe("write safety", () => {
  it("treats injection text as data", () => {
    const injection = "'; DROP TABLE items; --"
    const created = insertRecord(database, {
      table: "items",
      values: { name: text(injection) },
    })
    expect(created.record.values.name).toEqual(text(injection))
    expectMutationError(
      () =>
        insertRecord(database, {
          table: "items; DROP TABLE items",
          values: {},
        }),
      404
    )
    expectMutationError(
      () =>
        insertRecord(database, {
          table: "items",
          values: { "name) VALUES ('x'); --": text("y") },
        }),
      400
    )
    expect(countRows("items")).toBe(2)
  })

  it("does not create extra schema objects", () => {
    const before = database
      .prepare("SELECT type, name FROM sqlite_schema ORDER BY type, name")
      .all()
    const created = insertItem("apple")
    const updated = updateRecord(database, {
      table: "items",
      key: created.record.key,
      expectedSignature: created.record.signature,
      values: { qty: integer("3") },
    })
    deleteRecords(database, {
      table: "items",
      items: [
        {
          key: updated.record.key,
          expectedSignature: updated.record.signature,
        },
      ],
    })
    expect(
      database
        .prepare("SELECT type, name FROM sqlite_schema ORDER BY type, name")
        .all()
    ).toEqual(before)
  })

  it("rolls back an uncommitted transaction when the connection closes", () => {
    const connection = openDatabase({ file })
    connection.exec("BEGIN IMMEDIATE")
    connection
      .prepare("INSERT INTO parent (id, name) VALUES (?, ?)")
      .run(4242n, "uncommitted")
    // 子进程被终止时就是这样：连接关闭，未提交事务由 SQLite 回滚
    closeDatabase(connection)
    expect(countRows("parent")).toBe(2)
  })

  it("applies foreign key cascades and marks them in metadata", () => {
    const parent = getRecord(database, {
      table: "parent",
      key: [{ column: "id", value: integer("1") }],
    }).record
    insertRecord(database, {
      table: "cascader",
      values: { parent_id: integer("1") },
    })
    expect(countRows("cascader")).toBe(1)
    deleteRecords(database, {
      table: "parent",
      items: [{ key: parent.key, expectedSignature: parent.signature }],
    })
    // 级联删除是数据库行为，元信息里的 referencedBy 已经标注
    expect(countRows("cascader")).toBe(0)
    expect(countRows("parent")).toBe(1)
  })
})
