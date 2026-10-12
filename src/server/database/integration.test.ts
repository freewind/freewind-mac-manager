import { mkdtempSync, rmSync } from "node:fs"
import type { Server } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { createApp } from "@server/app"
import { TaskStore } from "@server/common/tasks/store"
import { createInlineHost } from "@server/common/tasks/worker-host"
import { closeDatabase, openDatabase } from "@server/database/connection"
import {
  createDatabaseService,
  type DatabaseService,
} from "@server/database/handlers"
import { createMutationRunner } from "@server/database/mutation-runner"
import { createQueryRunner } from "@server/database/query-runner"
import { createTaskRuntime, type TaskRuntime } from "@server/tasks/runtime"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

/**
 * database 域的全链集成测试：真实 createApp（真实契约、认证与 handler），
 * 真实查询/写入子进程，只把库指向临时文件——不碰真实业务库，也不碰真实 docker。
 *
 * 覆盖：7 个端点的成功与失败状态、认证 401、非法输入 400、受保护表 403、
 * 缺失 404、并发与约束 409、查询忙 429、写入超时 executionStatus=unknown。
 */

const TEST_PASSWORD = "integration-password-1234"

const DDL = `
CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  qty INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  note TEXT DEFAULT NULL,
  total INTEGER GENERATED ALWAYS AS (qty * 2) STORED
);
CREATE TABLE composite (a TEXT NOT NULL, b INTEGER NOT NULL, label TEXT, PRIMARY KEY(a, b));
CREATE TABLE nopk (a TEXT);
CREATE VIEW v_items AS SELECT id, name FROM items;
INSERT INTO items (name, qty) VALUES ('seed', 1);
INSERT INTO composite (a, b, label) VALUES ('a1', 1, 'first'), ('a1', 2, 'second');
`

type RunningApp = {
  url: string
  server: Server
  runtime: TaskRuntime
  store: TaskStore
  taskDir: string
}

let dir: string
let file: string
let env: NodeJS.ProcessEnv
let apps: RunningApp[]
let main: RunningApp
let service: DatabaseService
let authorization = ""

const startApp = async (database: DatabaseService): Promise<RunningApp> => {
  const taskDir = mkdtempSync(path.join(tmpdir(), "mac-manager-db-http-tasks-"))
  const store = new TaskStore(path.join(taskDir, "tasks.sqlite3"))
  const runtime = createTaskRuntime({
    store,
    host: createInlineHost(async () => ({
      result: null,
      message: null,
      status: "done" as const,
    })),
    thresholdMs: 20,
  })
  const app = createApp({
    tasks: runtime,
    initializeBusiness: false,
    database,
  })
  const server = app.listen(0)
  await new Promise((resolve) => server.once("listening", resolve))
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  const entry = {
    url: `http://127.0.0.1:${port}`,
    server,
    runtime,
    store,
    taskDir,
  }
  apps.push(entry)
  return entry
}

const send = async (
  method: string,
  url: string,
  options: { body?: unknown; auth?: boolean; base?: string } = {}
) => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  }
  if (options.auth !== false && authorization) {
    headers.authorization = authorization
  }
  const response = await fetch(`${options.base ?? main.url}${url}`, {
    method,
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  })
  const text = await response.text()
  return {
    status: response.status,
    body: text.length > 0 ? JSON.parse(text) : null,
  }
}

const text = (value: string) => ({ type: "text", value })
const integer = (value: string) => ({ type: "integer", value })

const idOf = (body: {
  record: { values: Record<string, { type: string; value?: unknown }> }
}): string => String(body.record.values.id?.value ?? "")

const insertItem = async (name: string) =>
  send("POST", "/api/database/tables/items/records", {
    body: { values: { name: text(name) } },
  })

const itemNames = (): string[] => {
  const reader = openDatabase({ file, mode: "readonly" })
  try {
    return (
      reader.prepare("SELECT name FROM items ORDER BY name").all() as Array<{
        name: string
      }>
    ).map((row) => row.name)
  } finally {
    closeDatabase(reader)
  }
}

beforeEach(async () => {
  process.env.MAC_MANAGER_PASSWORD = TEST_PASSWORD
  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-db-http-"))
  file = path.join(dir, "app.sqlite3")
  const setup = openDatabase({ file })
  setup.exec(DDL)
  setup.close()
  env = { ...process.env, MAC_MANAGER_DB_FILE: file }
  apps = []
  service = createDatabaseService({ env })
  main = await startApp(service)

  const loginResponse = await fetch(`${main.url}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: TEST_PASSWORD }),
  })
  expect(loginResponse.status).toBe(200)
  authorization = `Bearer ${TEST_PASSWORD}`
})

afterEach(async () => {
  delete process.env.MAC_MANAGER_PASSWORD
  authorization = ""
  for (const app of apps) {
    app.runtime.runner.shutdown()
    app.store.close()
    await new Promise((resolve) => app.server.close(resolve))
    rmSync(app.taskDir, { recursive: true, force: true })
  }
  service.shutdown()
  rmSync(dir, { recursive: true, force: true })
})

describe("database HTTP 认证", () => {
  it("refuses to read the database without the access password", async () => {
    const anonymous = await send("GET", "/api/database/tables", { auth: false })
    expect(anonymous.status).toBe(401)
    expect(anonymous.body).toEqual({ message: "需要访问密码" })
    // 未登录时不能泄露任何表名
    expect(JSON.stringify(anonymous.body)).not.toContain("items")

    const wrong = await send("GET", "/api/database/tables", {
      auth: false,
      body: undefined,
    })
    expect(wrong.status).toBe(401)
  })

  it("refuses writes without the access password", async () => {
    const anonymous = await send("POST", "/api/database/tables/items/records", {
      auth: false,
      body: { values: { name: text("anonymous") } },
    })
    expect(anonymous.status).toBe(401)
    expect(itemNames()).toEqual(["seed"])
  })
})

describe("database HTTP 只读端点", () => {
  it("lists tables without counting rows", async () => {
    const response = await send("GET", "/api/database/tables")
    expect(response.status).toBe(200)
    const names = response.body.tables.map(
      (item: { name: string }) => item.name
    )
    expect(names).toEqual(
      expect.arrayContaining(["items", "composite", "nopk", "v_items"])
    )
    for (const table of response.body.tables) {
      expect(table.rowCount).toBeNull()
      expect(table.capabilities).toHaveLength(4)
    }
    const nopk = response.body.tables.find(
      (item: { name: string }) => item.name === "nopk"
    )
    expect(nopk.capabilities).toContainEqual({
      operation: "insert",
      allowed: false,
      reason: "no_primary_key",
      message: "没有显式可靠的非空唯一主键，无法安全定位单条记录，只读",
    })
  })

  it("returns the table structure", async () => {
    const response = await send("GET", "/api/database/tables/items")
    expect(response.status).toBe(200)
    expect(response.body.constraints.primaryKey).toEqual(["id"])
    expect(response.body.constraints.unique).toEqual([
      { name: "sqlite_autoindex_items_1", columns: ["name"] },
    ])
    expect(
      response.body.columns.find(
        (column: { name: string }) => column.name === "total"
      ).generated
    ).toBe(true)
    expect(response.body.signature).toHaveLength(32)
  })

  it("pages and filters records through the extended query parser", async () => {
    const query = new URLSearchParams({
      page: "1",
      pageSize: "1",
      "filters[0][column]": "qty",
      "filters[0][operator]": "gte",
      "filters[0][value][type]": "integer",
      "filters[0][value][value]": "1",
      "sorts[0][column]": "id",
      "sorts[0][direction]": "desc",
    })
    const response = await send(
      "GET",
      `/api/database/tables/items/records?${query.toString()}`
    )
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ page: 1, pageSize: 1, total: 1 })
    expect(response.body.records[0].values.name).toEqual(text("seed"))
    expect(response.body.records[0].signature).toHaveLength(32)
  })

  it("locates one record by a composite primary key", async () => {
    const query = new URLSearchParams({
      "key[0][column]": "a",
      "key[0][value][type]": "text",
      "key[0][value][value]": "a1",
      "key[1][column]": "b",
      "key[1][value][type]": "integer",
      "key[1][value][value]": "2",
    })
    const response = await send(
      "GET",
      `/api/database/tables/composite/record?${query.toString()}`
    )
    expect(response.status).toBe(200)
    expect(response.body.record.values.label).toEqual(text("second"))

    const missing = await send(
      "GET",
      `/api/database/tables/composite/record?${new URLSearchParams({
        "key[0][column]": "a",
        "key[0][value][type]": "text",
        "key[0][value][value]": "nope",
        "key[1][column]": "b",
        "key[1][value][type]": "integer",
        "key[1][value][value]": "1",
      }).toString()}`
    )
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ message: "记录不存在" })
  })

  it("rejects illegal input and unknown tables", async () => {
    const tooBig = await send(
      "GET",
      "/api/database/tables/items/records?pageSize=101"
    )
    expect(tooBig.status).toBe(400)

    const badColumn = await send(
      "GET",
      `/api/database/tables/items/records?${new URLSearchParams({
        "filters[0][column]": "nope",
        "filters[0][operator]": "eq",
        "filters[0][value][type]": "text",
        "filters[0][value][value]": "x",
      }).toString()}`
    )
    expect(badColumn.status).toBe(400)
    expect(badColumn.body.message).toContain("列「nope」不存在")

    const missing = await send("GET", "/api/database/tables/no_such_table")
    expect(missing.status).toBe(404)
  })
})

describe("database HTTP 写入端点", () => {
  it("inserts with 201 and reads the row back", async () => {
    const created = await insertItem("apple")
    expect(created.status).toBe(201)
    expect(created.body.record.values.name).toEqual(text("apple"))
    expect(created.body.record.values.qty).toEqual(integer("0"))

    const query = new URLSearchParams({
      "key[0][column]": "id",
      "key[0][value][type]": "integer",
      "key[0][value][value]": idOf(created.body),
    })
    const read = await send(
      "GET",
      `/api/database/tables/items/record?${query.toString()}`
    )
    expect(read.status).toBe(200)
    expect(read.body.record).toEqual(created.body.record)
  })

  it("updates with 200 and refuses a stale signature with 409", async () => {
    const created = await insertItem("apple")
    const key = created.body.record.key

    const updated = await send("PATCH", "/api/database/tables/items/records", {
      body: {
        key,
        expectedSignature: created.body.record.signature,
        values: { qty: integer("5") },
      },
    })
    expect(updated.status).toBe(200)
    expect(updated.body.record.values.qty).toEqual(integer("5"))
    expect(updated.body.record.values.total).toEqual(integer("10"))

    const stale = await send("PATCH", "/api/database/tables/items/records", {
      body: {
        key,
        expectedSignature: created.body.record.signature,
        values: { qty: integer("9") },
      },
    })
    expect(stale.status).toBe(409)
    expect(stale.body).toEqual({
      message: "记录已变化，请重新读取后再修改",
      executionStatus: "not_started",
    })

    const empty = await send("PATCH", "/api/database/tables/items/records", {
      body: {
        key,
        expectedSignature: updated.body.record.signature,
        values: {},
      },
    })
    expect(empty.status).toBe(400)
  })

  it("deletes atomically and reports only the deleted keys", async () => {
    const created = await insertItem("apple")
    const deleted = await send(
      "POST",
      "/api/database/tables/items/records/delete",
      {
        body: {
          items: [
            {
              key: created.body.record.key,
              expectedSignature: created.body.record.signature,
            },
          ],
        },
      }
    )
    expect(deleted.status).toBe(200)
    expect(deleted.body).toEqual({
      deleted: [created.body.record.key],
      conflicts: [],
      failed: [],
    })
    expect(itemNames()).toEqual(["seed"])

    const gone = await send(
      "GET",
      `/api/database/tables/items/record?${new URLSearchParams({
        "key[0][column]": "id",
        "key[0][value][type]": "integer",
        "key[0][value][value]": idOf(created.body),
      }).toString()}`
    )
    expect(gone.status).toBe(404)
  })

  it("refuses protected tables with 403", async () => {
    for (const table of ["nopk", "v_items", "sqlite_schema"]) {
      const response = await send(
        "POST",
        `/api/database/tables/${table}/records`,
        { body: { values: { a: text("x") } } }
      )
      expect(response.status).toBe(403)
    }
    expect(itemNames()).toEqual(["seed"])
  })

  it("maps constraint conflicts to 409 without leaking values or SQL", async () => {
    const conflict = await insertItem("seed")
    expect(conflict.status).toBe(409)
    expect(conflict.body.executionStatus).toBe("not_started")
    expect(conflict.body.message).toContain("违反唯一约束")
    // 不泄露被写入的原值，也不回传内部 SQL
    expect(conflict.body.message).not.toContain("seed")
    expect(JSON.stringify(conflict.body)).not.toContain("INSERT")
    expect(JSON.stringify(conflict.body)).not.toContain("constraint failed")
  })

  it("ignores extra fields and never runs them as SQL", async () => {
    const response = await send("POST", "/api/database/tables/items/records", {
      body: {
        values: { name: text("apple") },
        sql: "DROP TABLE items",
        table: "sqlite_schema",
      },
    })
    expect(response.status).toBe(201)
    expect(itemNames()).toEqual(["apple", "seed"])
  })

  it("rejects an unknown column with 400", async () => {
    const response = await send("POST", "/api/database/tables/items/records", {
      body: { values: { nope: text("x") } },
    })
    expect(response.status).toBe(400)
    expect(response.body.message).toContain("列「nope」不存在")
  })
})

describe("database HTTP 资源与执行状态", () => {
  it("returns 429 when the query runner is busy", async () => {
    const busy = await startApp(
      createDatabaseService({
        env,
        queryRunner: createQueryRunner({
          env,
          maxConcurrency: 0,
          queueLimit: 0,
        }),
      })
    )
    const response = await send("GET", "/api/database/tables", {
      base: busy.url,
    })
    expect(response.status).toBe(429)
    expect(response.body.message).toContain("查询请求过多")
  })

  it("reports a write timeout as unknown without writing anything", async () => {
    const locker = openDatabase({ file })
    locker.exec("BEGIN IMMEDIATE")
    locker.prepare("INSERT INTO items (name) VALUES (?)").run("locker")
    try {
      const slow = await startApp(
        createDatabaseService({
          env,
          mutationRunner: createMutationRunner({ env, timeoutMs: 2500 }),
        })
      )
      const response = await send(
        "POST",
        "/api/database/tables/items/records",
        {
          base: slow.url,
          body: { values: { name: text("timeout") } },
        }
      )
      expect(response.status).toBe(500)
      expect(response.body.executionStatus).toBe("unknown")
      expect(response.body.message).toContain("结果未知")
    } finally {
      locker.exec("ROLLBACK")
      closeDatabase(locker)
    }
    // 超时只说明结果未知：既没写进去，也不能报成失败或自动重发
    expect(itemNames()).toEqual(["seed"])
  })
})
