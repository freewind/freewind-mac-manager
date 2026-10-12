import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { closeDatabase, openDatabase } from "./connection"
import { DatabaseQueryError } from "./query-protocol"
import { createQueryRunner, type DatabaseQueryRunner } from "./query-runner"

/**
 * 假 worker：按任务里的表名决定行为，用来验证父进程的超时、并发、排队与
 * 协议校验；真实 worker 的端到端行为放在最后一个用例里跑。
 */
const FAKE_WORKER = `
const TABLE = {
  name: "t",
  kind: "table",
  rowCount: null,
  capabilities: [
    { operation: "read", allowed: true },
    { operation: "insert", allowed: true },
    { operation: "update", allowed: true },
    { operation: "delete", allowed: true },
  ],
  columns: [
    {
      name: "id",
      declaredType: "INTEGER",
      affinity: "integer",
      notNull: false,
      primaryKeyPosition: 1,
      generated: false,
      hidden: false,
      write: { allowed: true },
    },
  ],
  constraints: { primaryKey: ["id"], unique: [], foreignKeys: [], checks: [] },
  signature: "sig",
  withoutRowId: false,
  triggers: [],
  referencedBy: [],
}

let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => { input += chunk })
process.stdin.on("end", () => {
  const job = JSON.parse(input)
  const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n")
  const table = job.table || ""
  if (job.kind === "list_tables") { write({ type: "result", result: { tables: [] } }); return }
  if (table === "boom") { process.exitCode = 3; return }
  if (table === "garbage") { process.stdout.write("not a message\\n"); return }
  if (table === "fail") {
    write({ type: "failed", error: "表或视图不存在", httpStatus: 404 })
    return
  }
  if (table === "badschema") { write({ type: "result", result: { nope: true } }); return }
  if (table === "slow") { setTimeout(() => write({ type: "result", result: TABLE }), 400); return }
  write({ type: "result", result: TABLE })
})
`

const DDL = `
CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
INSERT INTO items (id, name) VALUES (1, 'apple'), (2, 'banana');
`

let dir: string
let fakeWorkerFile: string
let file: string
let database: ReturnType<typeof openDatabase>
let runner: DatabaseQueryRunner

const startRunner = (options: Parameters<typeof createQueryRunner>[0] = {}) => {
  runner = createQueryRunner({
    command: process.execPath,
    args: [fakeWorkerFile],
    env: { ...process.env },
    ...options,
  })
  return runner
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-query-runner-"))
  file = path.join(dir, "app.sqlite3")
  fakeWorkerFile = path.join(dir, "fake-worker.mjs")
  writeFileSync(fakeWorkerFile, FAKE_WORKER)
  const setup = openDatabase({ file })
  setup.exec(DDL)
  setup.close()
  database = openDatabase({ file, mode: "readonly" })
  startRunner()
})

afterEach(() => {
  runner.shutdown()
  closeDatabase(database)
  rmSync(dir, { recursive: true, force: true })
})

const rejection = async (run: Promise<unknown>) => {
  try {
    await run
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseQueryError)
    return error as DatabaseQueryError
  }
  throw new Error("应当抛错")
}

describe("query runner", () => {
  it("returns the worker result after contract validation", async () => {
    await expect(runner.listTables()).resolves.toEqual({ tables: [] })
    await expect(runner.getTable("ok")).resolves.toMatchObject({
      name: "t",
      kind: "table",
    })
    expect(runner.stats()).toEqual({ running: 0, queued: 0 })
  })

  it("rejects a worker result that does not match the contract", async () => {
    const error = await rejection(runner.getTable("badschema"))
    expect(error.httpStatus).toBe(500)
    expect(error.message).toContain("不符合契约")
  })

  it("passes through a declared business failure", async () => {
    const error = await rejection(runner.getTable("fail"))
    expect(error.httpStatus).toBe(404)
    expect(error.message).toBe("表或视图不存在")
  })

  it("rejects a crashed or unreadable worker", async () => {
    const crashed = await rejection(runner.getTable("boom"))
    expect(crashed.httpStatus).toBe(500)
    expect(crashed.message).toContain("未返回结果")
    const garbage = await rejection(runner.getTable("garbage"))
    expect(garbage.httpStatus).toBe(500)
  })

  it("kills a worker that exceeds the timeout and frees the slot", async () => {
    startRunner({ timeoutMs: 120 })
    const startedAt = Date.now()
    const error = await rejection(runner.getTable("slow"))
    expect(error.httpStatus).toBe(500)
    expect(error.message).toContain("毫秒")
    // 不能等 worker 自己结束
    expect(Date.now() - startedAt).toBeLessThan(1000)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(runner.stats()).toEqual({ running: 0, queued: 0 })
  })

  it("runs 2 at a time, queues 8 and refuses the rest with 429", async () => {
    const calls = Array.from({ length: 11 }, () => runner.getTable("slow"))
    expect(runner.stats()).toEqual({ running: 2, queued: 8 })
    const results = await Promise.allSettled(calls)
    const rejected = results.filter((item) => item.status === "rejected")
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      DatabaseQueryError
    )
    expect(
      ((rejected[0] as PromiseRejectedResult).reason as DatabaseQueryError)
        .httpStatus
    ).toBe(429)
    expect(runner.stats()).toEqual({ running: 0, queued: 0 })
  })

  it("rejects queued and running queries on shutdown", async () => {
    const calls = Array.from({ length: 3 }, () => runner.getTable("slow"))
    // 等子进程真的起来再关，才能同时覆盖运行中与排队中的两种
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(runner.stats()).toEqual({ running: 2, queued: 1 })
    runner.shutdown()
    const results = await Promise.allSettled(calls)
    expect(results.every((item) => item.status === "rejected")).toBe(true)
    const afterShutdown = await rejection(runner.getTable("ok"))
    expect(afterShutdown.httpStatus).toBe(500)
  })
})

describe("query runner with the real worker", () => {
  it("reads tables, records and a single record from a temporary database", async () => {
    runner = createQueryRunner({
      env: { ...process.env, MAC_MANAGER_DB_FILE: file },
    })
    const tables = await runner.listTables()
    expect(tables.tables.map((item) => item.name)).toContain("items")

    const detail = await runner.getTable("items")
    expect(detail.columns.map((column) => column.name)).toEqual(["id", "name"])

    const records = await runner.listRecords({
      table: "items",
      page: 1,
      pageSize: 10,
      filters: [],
      sorts: [{ column: "id", direction: "desc" }],
    })
    expect(records.total).toBe(2)
    expect(records.records[0].values.name).toEqual({
      type: "text",
      value: "banana",
    })

    const record = await runner.getRecord({
      table: "items",
      key: [{ column: "id", value: { type: "integer", value: "1" } }],
    })
    expect(record.record.values.name).toEqual({
      type: "text",
      value: "apple",
    })
  }, 30_000)
})
