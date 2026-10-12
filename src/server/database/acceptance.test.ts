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
 * 通用数据库管理的端到端自动验收。
 *
 * 走真实 createApp（真实契约、认证、handler）与真实查询/写入子进程，
 * 库指向临时文件；表在应用启动之后才创建，用来证明「新增业务表不需要新管理代码」。
 * 每条用例对应 docs/database.md 里的一条验收标准。
 */

const TEST_PASSWORD = "acceptance-password-1234"

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
  const taskDir = mkdtempSync(
    path.join(tmpdir(), "mac-manager-db-accept-tasks-")
  )
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

// 与 integration.test.ts 一致：不写显式 any，靠 JSON.parse 推断响应体
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
const nullValue = { type: "null" }

/** 用独立连接执行 SQL：模拟「其他域新建业务表」。 */
const execSql = (sql: string): void => {
  const connection = openDatabase({ file })
  connection.exec(sql)
  closeDatabase(connection)
}

const readRows = (sql: string): Array<Record<string, unknown>> => {
  const reader = openDatabase({ file, mode: "readonly" })
  try {
    return reader.prepare(sql).all() as Array<Record<string, unknown>>
  } finally {
    closeDatabase(reader)
  }
}

const tableNames = async (): Promise<string[]> => {
  const response = await send("GET", "/api/database/tables")
  expect(response.status).toBe(200)
  return response.body.tables.map((item: { name: string }) => item.name)
}

const keyQuery = (parts: Array<[string, string, string]>): string =>
  new URLSearchParams(
    parts.flatMap(([column, type, value], index) => [
      [`key[${index}][column]`, column],
      [`key[${index}][value][type]`, type],
      [`key[${index}][value][value]`, value],
    ])
  ).toString()

beforeEach(async () => {
  process.env.MAC_MANAGER_PASSWORD = TEST_PASSWORD
  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-db-accept-"))
  file = path.join(dir, "app.sqlite3")
  // 空库：所有业务表都在应用启动之后创建
  closeDatabase(openDatabase({ file }))
  env = { ...process.env, MAC_MANAGER_DB_FILE: file }
  apps = []
  service = createDatabaseService({ env })
  main = await startApp(service)

  const login = await fetch(`${main.url}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: TEST_PASSWORD }),
  })
  expect(login.status).toBe(200)
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

describe("验收 1：临时库新增普通表与复合主键表即可管理", () => {
  it("启动后新建的表无需任何新代码就能查询、新增、修改、删除", async () => {
    expect(await tableNames()).not.toContain("later_items")

    execSql(`
      CREATE TABLE later_items (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        note TEXT
      );
    `)
    execSql(`
      CREATE TABLE later_composite (
        a TEXT NOT NULL,
        b INTEGER NOT NULL,
        label TEXT,
        PRIMARY KEY (a, b)
      );
    `)

    // 刷新即可见，不需要重启服务，也没有为这两张表写过任何代码
    const names = await tableNames()
    expect(names).toEqual(
      expect.arrayContaining(["later_items", "later_composite"])
    )

    const structure = await send("GET", "/api/database/tables/later_composite")
    expect(structure.status).toBe(200)
    expect(structure.body.constraints.primaryKey).toEqual(["a", "b"])
    expect(structure.body.capabilities).toEqual([
      { operation: "read", allowed: true },
      { operation: "insert", allowed: true },
      { operation: "update", allowed: true },
      { operation: "delete", allowed: true },
    ])

    // 单主键表：增 → 查 → 改 → 删
    const created = await send(
      "POST",
      "/api/database/tables/later_items/records",
      {
        body: { values: { name: text("apple"), note: nullValue } },
      }
    )
    expect(created.status).toBe(201)
    expect(created.body.record.values.note).toEqual(nullValue)
    const singleKey = created.body.record.key

    const updated = await send(
      "PATCH",
      "/api/database/tables/later_items/records",
      {
        body: {
          key: singleKey,
          expectedSignature: created.body.record.signature,
          values: { note: text("改过") },
        },
      }
    )
    expect(updated.status).toBe(200)
    expect(updated.body.record.values.note).toEqual(text("改过"))

    const deleted = await send(
      "POST",
      "/api/database/tables/later_items/records/delete",
      {
        body: {
          items: [
            {
              key: updated.body.record.key,
              expectedSignature: updated.body.record.signature,
            },
          ],
        },
      }
    )
    expect(deleted.status).toBe(200)
    expect(readRows("SELECT count(*) AS n FROM later_items")).toEqual([
      { n: 0n },
    ])

    // 复合主键表：两个键都要给全
    const composite = await send(
      "POST",
      "/api/database/tables/later_composite/records",
      {
        body: {
          values: { a: text("k1"), b: integer("2"), label: text("first") },
        },
      }
    )
    expect(composite.status).toBe(201)
    expect(composite.body.record.key).toEqual([
      { column: "a", value: text("k1") },
      { column: "b", value: integer("2") },
    ])

    const readOne = await send(
      "GET",
      `/api/database/tables/later_composite/record?${keyQuery([
        ["a", "text", "k1"],
        ["b", "integer", "2"],
      ])}`
    )
    expect(readOne.status).toBe(200)
    expect(readOne.body.record.values.label).toEqual(text("first"))

    const compositeUpdate = await send(
      "PATCH",
      "/api/database/tables/later_composite/records",
      {
        body: {
          key: readOne.body.record.key,
          expectedSignature: readOne.body.record.signature,
          values: { label: text("second") },
        },
      }
    )
    expect(compositeUpdate.status).toBe(200)
    expect(compositeUpdate.body.record.values.label).toEqual(text("second"))

    const compositeDelete = await send(
      "POST",
      "/api/database/tables/later_composite/records/delete",
      {
        body: {
          items: [
            {
              key: compositeUpdate.body.record.key,
              expectedSignature: compositeUpdate.body.record.signature,
            },
          ],
        },
      }
    )
    expect(compositeDelete.status).toBe(200)
    expect(readRows("SELECT count(*) AS n FROM later_composite")).toEqual([
      { n: 0n },
    ])
  }, 60_000)
})

describe("验收 2：默认值、NULL、空串、大整数、生成列与 BLOB", () => {
  it("显示与提交语义正确，大整数不丢精度", async () => {
    execSql(`
      CREATE TABLE values_demo (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '默认名',
        note TEXT,
        payload BLOB,
        total INTEGER GENERATED ALWAYS AS (length(name)) STORED
      );
    `)

    // 省略 name 用默认值；note 显式 NULL；空串是值而不是 NULL
    const created = await send(
      "POST",
      "/api/database/tables/values_demo/records",
      {
        body: { values: { note: nullValue } },
      }
    )
    expect(created.status).toBe(201)
    expect(created.body.record.values.name).toEqual(text("默认名"))
    expect(created.body.record.values.note).toEqual(nullValue)
    // 生成列由数据库算出，也要能读回
    expect(created.body.record.values.total).toEqual(integer("3"))

    const emptyText = await send(
      "PATCH",
      "/api/database/tables/values_demo/records",
      {
        body: {
          key: created.body.record.key,
          expectedSignature: created.body.record.signature,
          values: { name: text(""), note: text("") },
        },
      }
    )
    expect(emptyText.status).toBe(200)
    expect(emptyText.body.record.values.name).toEqual(text(""))
    expect(emptyText.body.record.values.note).toEqual(text(""))

    // 大整数主键：十进制字符串原样往返，不经过 Number
    const big = await send("POST", "/api/database/tables/values_demo/records", {
      body: {
        values: { id: integer("9007199254740993"), name: text("big") },
      },
    })
    expect(big.status).toBe(201)
    expect(big.body.record.values.id).toEqual(integer("9007199254740993"))
    const bigRead = await send(
      "GET",
      `/api/database/tables/values_demo/record?${keyQuery([
        ["id", "integer", "9007199254740993"],
      ])}`
    )
    expect(bigRead.status).toBe(200)
    expect(bigRead.body.record.values.id).toEqual(integer("9007199254740993"))

    // 生成列不能写
    const writeGenerated = await send(
      "POST",
      "/api/database/tables/values_demo/records",
      { body: { values: { name: text("x"), total: integer("9") } } }
    )
    expect(writeGenerated.status).toBe(400)
    expect(writeGenerated.body.message).toContain("生成列")

    // BLOB 首期只读：写入被拒，读取按字节数展示
    execSql("UPDATE values_demo SET payload = x'414243' WHERE name = 'big'")
    const blobRead = await send(
      "GET",
      `/api/database/tables/values_demo/record?${keyQuery([
        ["id", "integer", "9007199254740993"],
      ])}`
    )
    expect(blobRead.body.record.values.payload).toEqual({
      type: "blob",
      base64: "QUJD",
    })
    const writeBlob = await send(
      "PATCH",
      "/api/database/tables/values_demo/records",
      {
        body: {
          key: blobRead.body.record.key,
          expectedSignature: blobRead.body.record.signature,
          values: { payload: text("x") },
        },
      }
    )
    expect(writeBlob.status).toBe(400)
    expect(writeBlob.body.message).toContain("BLOB")
  }, 60_000)
})

describe("验收 3：受保护对象与注入输入", () => {
  it("系统表、虚拟表、影子表、视图与无主键表都拒绝写入", async () => {
    execSql("CREATE TABLE no_pk (a TEXT)")
    execSql("CREATE VIEW demo_view AS SELECT 1 AS x")
    execSql("CREATE VIRTUAL TABLE demo_fts USING fts5(body)")

    for (const table of [
      "sqlite_schema",
      "no_pk",
      "demo_view",
      "demo_fts",
      "demo_fts_data",
    ]) {
      const response = await send(
        "POST",
        `/api/database/tables/${table}/records`,
        { body: { values: { a: text("x") } } }
      )
      expect([403, 400]).toContain(response.status)
      expect(response.status).not.toBe(201)
    }

    const reasons = await send("GET", "/api/database/tables")
    const byName = new Map(
      reasons.body.tables.map(
        (item: { name: string; capabilities: unknown }) => [item.name, item]
      )
    )
    expect(
      (byName.get("no_pk") as { capabilities: Array<{ allowed: boolean }> })
        .capabilities
    ).toContainEqual({
      operation: "insert",
      allowed: false,
      reason: "no_primary_key",
      message: "没有显式可靠的非空唯一主键，无法安全定位单条记录，只读",
    })
    expect(readRows("SELECT count(*) AS n FROM no_pk")).toEqual([{ n: 0n }])
  }, 60_000)

  it("带空格、引号与非 ASCII 的表列名可用，注入文本只当数据", async () => {
    execSql(
      `CREATE TABLE "weird ok" ("id" INTEGER PRIMARY KEY, "a b" TEXT, "q""d" TEXT)`
    )
    execSql("CREATE TABLE inject_demo (id INTEGER PRIMARY KEY, name TEXT)")

    const weird = await send(
      "POST",
      `/api/database/tables/weird%20ok/records`,
      {
        body: { values: { "a b": text("空格列"), 'q"d': text("引号列") } },
      }
    )
    expect(weird.status).toBe(201)
    expect(weird.body.record.values['q"d']).toEqual(text("引号列"))

    // 恶意表名不会变成 SQL：表不存在就是 404，注入片段本身不执行
    const badTable = await send(
      "POST",
      "/api/database/tables/inject_demo%3B%20DROP%20TABLE%20inject_demo/records",
      { body: { values: { name: text("x") } } }
    )
    expect(badTable.status).toBe(404)

    // 恶意列名被拒绝
    const badColumn = await send(
      "POST",
      "/api/database/tables/inject_demo/records",
      { body: { values: { 'name") VALUES ("x"); --': text("y") } } }
    )
    expect(badColumn.status).toBe(400)

    // 注入文本按字面值写入
    const injection = "'; DROP TABLE inject_demo; --"
    const literal = await send(
      "POST",
      "/api/database/tables/inject_demo/records",
      { body: { values: { name: text(injection) } } }
    )
    expect(literal.status).toBe(201)
    expect(literal.body.record.values.name).toEqual(text(injection))
    expect(readRows("SELECT name FROM inject_demo")).toEqual([
      { name: injection },
    ])
  }, 60_000)
})

describe("验收 4：并发签名与约束", () => {
  it("过期签名返回 409 且不覆盖数据", async () => {
    execSql("CREATE TABLE concurrency_demo (id INTEGER PRIMARY KEY, note TEXT)")
    const created = await send(
      "POST",
      "/api/database/tables/concurrency_demo/records",
      { body: { values: { note: text("原始") } } }
    )
    const staleSignature = created.body.record.signature

    // 另一个连接先改掉
    execSql("UPDATE concurrency_demo SET note = '别人改的'")

    const conflict = await send(
      "PATCH",
      "/api/database/tables/concurrency_demo/records",
      {
        body: {
          key: created.body.record.key,
          expectedSignature: staleSignature,
          values: { note: text("我的修改") },
        },
      }
    )
    expect(conflict.status).toBe(409)
    expect(conflict.body.executionStatus).toBe("not_started")
    expect(readRows("SELECT note FROM concurrency_demo")).toEqual([
      { note: "别人改的" },
    ])
  }, 60_000)

  it("唯一、非空与 CHECK 约束冲突都被拒绝", async () => {
    execSql(`
      CREATE TABLE constraint_demo (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        qty INTEGER NOT NULL CHECK (qty >= 0)
      );
    `)
    const first = await send(
      "POST",
      "/api/database/tables/constraint_demo/records",
      { body: { values: { name: text("apple"), qty: integer("1") } } }
    )
    expect(first.status).toBe(201)

    const duplicate = await send(
      "POST",
      "/api/database/tables/constraint_demo/records",
      { body: { values: { name: text("apple"), qty: integer("1") } } }
    )
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.message).toContain("唯一约束")
    // 不泄露原值
    expect(duplicate.body.message).not.toContain("apple")

    const checkFailed = await send(
      "POST",
      "/api/database/tables/constraint_demo/records",
      { body: { values: { name: text("banana"), qty: integer("-1") } } }
    )
    expect(checkFailed.status).toBe(409)
    expect(checkFailed.body.message).toContain("CHECK")

    const notNull = await send(
      "POST",
      "/api/database/tables/constraint_demo/records",
      { body: { values: { name: nullValue, qty: integer("1") } } }
    )
    expect(notNull.status).toBe(409)
    expect(readRows("SELECT count(*) AS n FROM constraint_demo")).toEqual([
      { n: 1n },
    ])
  }, 60_000)

  it("批量删除中一条冲突则整体回滚", async () => {
    execSql("CREATE TABLE batch_demo (id INTEGER PRIMARY KEY, note TEXT)")
    const rows: Array<{ key: unknown; expectedSignature: string }> = []
    for (const note of ["a", "b", "c"]) {
      const created = await send(
        "POST",
        "/api/database/tables/batch_demo/records",
        { body: { values: { note: text(note) } } }
      )
      rows.push({
        key: created.body.record.key,
        expectedSignature: created.body.record.signature,
      })
    }
    execSql("UPDATE batch_demo SET note = '变了' WHERE id = 3")

    const failed = await send(
      "POST",
      "/api/database/tables/batch_demo/records/delete",
      { body: { items: rows } }
    )
    expect(failed.status).toBe(409)
    expect(failed.body.message).toContain("第 3 条")
    // 全成功或全回滚：前两条也不能被删掉
    expect(readRows("SELECT count(*) AS n FROM batch_demo")).toEqual([
      { n: 3n },
    ])
  }, 60_000)
})

describe("验收 5：结果未知与不重发", () => {
  it("写入超时按结果未知上报，且没有写入任何数据", async () => {
    execSql("CREATE TABLE timeout_demo (id INTEGER PRIMARY KEY, note TEXT)")
    const locker = openDatabase({ file })
    locker.exec("BEGIN IMMEDIATE")
    locker.prepare("INSERT INTO timeout_demo (note) VALUES (?)").run("locked")
    try {
      const slow = await startApp(
        createDatabaseService({
          env,
          mutationRunner: createMutationRunner({ env, timeoutMs: 1200 }),
        })
      )
      const response = await send(
        "POST",
        "/api/database/tables/timeout_demo/records",
        { base: slow.url, body: { values: { note: text("timeout") } } }
      )
      expect(response.status).toBe(500)
      expect(response.body.executionStatus).toBe("unknown")
      expect(response.body.message).toContain("结果未知")
    } finally {
      locker.exec("ROLLBACK")
      closeDatabase(locker)
    }
    // 超时只说明结果未知：超时那次没有写进去（锁连接的插入也已回滚），
    // 也不能报成失败后自动重发
    expect(readRows("SELECT note FROM timeout_demo")).toEqual([])
  }, 60_000)
})

describe("验收 6：认证保护与子进程边界", () => {
  it("全部 7 个端点在没有密码时都是 401 且不泄露数据", async () => {
    execSql("CREATE TABLE guarded (id INTEGER PRIMARY KEY, name TEXT)")
    const endpoints: Array<[string, string, unknown?]> = [
      ["GET", "/api/database/tables"],
      ["GET", "/api/database/tables/guarded"],
      ["GET", "/api/database/tables/guarded/records"],
      [
        "GET",
        `/api/database/tables/guarded/record?${keyQuery([["id", "integer", "1"]])}`,
      ],
      ["POST", "/api/database/tables/guarded/records", { values: {} }],
      [
        "PATCH",
        "/api/database/tables/guarded/records",
        { key: [], expectedSignature: "x", values: {} },
      ],
      ["POST", "/api/database/tables/guarded/records/delete", { items: [] }],
    ]
    for (const [method, url, body] of endpoints) {
      const response = await send(method, url, { auth: false, body })
      expect(response.status).toBe(401)
      expect(JSON.stringify(response.body)).not.toContain("guarded")
    }
  }, 60_000)

  it("查询繁忙返回 429，与写入超时的 500 明确区分", async () => {
    execSql("CREATE TABLE busy_demo (id INTEGER PRIMARY KEY)")
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
    const busyResponse = await send("GET", "/api/database/tables", {
      base: busy.url,
    })
    expect(busyResponse.status).toBe(429)
    expect(busyResponse.body.message).toContain("查询请求过多")
    // 429 是「没开始」，与结果未知的 500 不是一回事
    expect(busyResponse.body.executionStatus).toBeUndefined()
  }, 60_000)

  it("页大小、筛选数量与删除条数都有明确上限", async () => {
    execSql("CREATE TABLE limits_demo (id INTEGER PRIMARY KEY, name TEXT)")
    const tooBig = await send(
      "GET",
      "/api/database/tables/limits_demo/records?pageSize=101"
    )
    expect(tooBig.status).toBe(400)

    const tooManyItems = await send(
      "POST",
      "/api/database/tables/limits_demo/records/delete",
      {
        body: {
          items: Array.from({ length: 101 }, (_, index) => ({
            key: [{ column: "id", value: integer(String(index + 1)) }],
            expectedSignature: "x",
          })),
        },
      }
    )
    expect(tooManyItems.status).toBe(400)

    const tooManyFilters = await send(
      "GET",
      `/api/database/tables/limits_demo/records?${new URLSearchParams(
        Array.from({ length: 9 }, (_, index) => [
          `filters[${index}][column]`,
          "name",
        ]).flatMap(([key, value]) => [
          [key, value],
          [`${key.replace("column", "operator")}`, "isNotNull"],
        ])
      ).toString()}`
    )
    expect(tooManyFilters.status).toBe(400)
  }, 60_000)
})
