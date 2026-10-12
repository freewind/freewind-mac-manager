import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { closeDatabase, openDatabase } from "./connection"
import { DatabaseMutationError } from "./mutation-protocol"
import {
  createMutationRunner,
  type DatabaseMutationRunner,
} from "./mutation-runner"
import { getRecord } from "./query"

/**
 * 假 worker：按任务里的表名决定行为，用来验证父进程的超时、并发、排队、协议校验
 * 与「被终止后事务回滚」；真实 worker 的端到端行为放在最后一个用例里跑。
 */
const FAKE_WORKER = `
import { appendFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => { input += chunk })
process.stdin.on("end", () => {
  const job = JSON.parse(input)
  const logFile = process.env.MUTATION_FAKE_LOG
  if (logFile) appendFileSync(logFile, "start\\n")
  const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n")
  const RECORD = {
    table: "t",
    record: {
      key: [{ column: "id", value: { type: "integer", value: "1" } }],
      values: { id: { type: "integer", value: "1" } },
      signature: "sig",
    },
  }
  const table = job.table || ""
  if (table === "boom") { process.exitCode = 3; return }
  if (table === "garbage") { process.stdout.write("not a message\\n"); return }
  if (table === "fail") {
    write({
      type: "failed",
      error: "记录已变化，请重新读取后再修改",
      httpStatus: 409,
      executionStatus: "not_started",
    })
    return
  }
  if (table === "badschema") { write({ type: "result", result: { nope: true } }); return }
  if (table === "hang") {
    const db = new DatabaseSync(process.env.MAC_MANAGER_DB_FILE, { timeout: 100 })
    db.exec("BEGIN IMMEDIATE")
    db.prepare("INSERT INTO marker (id) VALUES (?)").run(1n)
    setInterval(() => {}, 1000)
    return
  }
  if (job.kind === "delete") {
    write({ type: "result", result: { deleted: [], conflicts: [], failed: [] } })
    return
  }
  if (table === "slow") {
    setTimeout(() => write({ type: "result", result: RECORD }), 400)
    return
  }
  write({ type: "result", result: RECORD })
})
`

const DDL = `
CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, note TEXT);
CREATE TABLE marker (id INTEGER PRIMARY KEY);
`

let dir: string
let fakeWorkerFile: string
let logFile: string
let file: string
let runner: DatabaseMutationRunner

const startFakeRunner = (
  options: Parameters<typeof createMutationRunner>[0] = {}
) => {
  runner = createMutationRunner({
    command: process.execPath,
    args: [fakeWorkerFile],
    env: { ...process.env, MUTATION_FAKE_LOG: logFile },
    ...options,
  })
  return runner
}

const rejection = async (run: Promise<unknown>) => {
  try {
    await run
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseMutationError)
    return error as DatabaseMutationError
  }
  throw new Error("应当抛错")
}

const spawnCount = (): number =>
  readFileSync(logFile, "utf8")
    .split("\n")
    .filter((line) => line === "start").length

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-mutation-runner-"))
  file = path.join(dir, "app.sqlite3")
  fakeWorkerFile = path.join(dir, "fake-worker.mjs")
  logFile = path.join(dir, "spawns.log")
  writeFileSync(fakeWorkerFile, FAKE_WORKER)
  writeFileSync(logFile, "")
  const setup = openDatabase({ file })
  setup.exec(DDL)
  setup.close()
  startFakeRunner()
})

afterEach(() => {
  runner.shutdown()
  rmSync(dir, { recursive: true, force: true })
})

describe("mutation runner", () => {
  it("returns the worker result after contract validation", async () => {
    await expect(runner.insert({ table: "ok", values: {} })).resolves.toEqual({
      table: "t",
      record: {
        key: [{ column: "id", value: { type: "integer", value: "1" } }],
        values: { id: { type: "integer", value: "1" } },
        signature: "sig",
      },
    })
    expect(runner.stats()).toEqual({ running: 0, queued: 0 })
  })

  it("passes through a declared failure with its execution status", async () => {
    const error = await rejection(runner.insert({ table: "fail", values: {} }))
    expect(error.httpStatus).toBe(409)
    expect(error.executionStatus).toBe("not_started")
    expect(error.message).toContain("记录已变化")
  })

  it("reports an invalid worker result as unknown", async () => {
    const error = await rejection(
      runner.insert({ table: "badschema", values: {} })
    )
    expect(error.httpStatus).toBe(500)
    expect(error.executionStatus).toBe("unknown")
  })

  it("reports a crashed or unreadable worker as unknown", async () => {
    const crashed = await rejection(
      runner.insert({ table: "boom", values: {} })
    )
    expect(crashed.httpStatus).toBe(500)
    expect(crashed.executionStatus).toBe("unknown")
    const garbage = await rejection(
      runner.insert({ table: "garbage", values: {} })
    )
    expect(garbage.executionStatus).toBe("unknown")
  })

  it("reports a timeout as unknown and never retries", async () => {
    startFakeRunner({ timeoutMs: 120 })
    const error = await rejection(runner.insert({ table: "slow", values: {} }))
    expect(error.httpStatus).toBe(500)
    expect(error.executionStatus).toBe("unknown")
    expect(error.message).toContain("结果未知")
    // 不自动重发：只启动过一次子进程
    expect(spawnCount()).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(runner.stats()).toEqual({ running: 0, queued: 0 })
  })

  it("rolls back an uncommitted transaction when the worker is killed", async () => {
    startFakeRunner({ timeoutMs: 300 })
    const error = await rejection(runner.insert({ table: "hang", values: {} }))
    expect(error.executionStatus).toBe("unknown")
    // 子进程被杀后连接关闭，未提交的事务由 SQLite 回滚
    const reader = openDatabase({ file, mode: "readonly" })
    try {
      const row = reader.prepare("SELECT count(*) AS n FROM marker").get() as {
        n: bigint
      }
      expect(Number(row.n)).toBe(0)
    } finally {
      closeDatabase(reader)
    }
  })

  it("runs one write at a time, queues 8 and refuses the rest with 429", async () => {
    const calls = Array.from({ length: 10 }, () =>
      runner.insert({ table: "slow", values: {} })
    )
    expect(runner.stats()).toEqual({ running: 1, queued: 8 })
    const results = await Promise.allSettled(calls)
    const rejected = results.filter((item) => item.status === "rejected")
    expect(rejected).toHaveLength(1)
    const reason = (rejected[0] as PromiseRejectedResult).reason
    expect(reason).toBeInstanceOf(DatabaseMutationError)
    expect((reason as DatabaseMutationError).httpStatus).toBe(429)
    expect((reason as DatabaseMutationError).executionStatus).toBe(
      "not_started"
    )
    expect(runner.stats()).toEqual({ running: 0, queued: 0 })
  })

  it("rejects queued and running writes on shutdown", async () => {
    const calls = Array.from({ length: 3 }, () =>
      runner.insert({ table: "slow", values: {} })
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(runner.stats()).toEqual({ running: 1, queued: 2 })
    runner.shutdown()
    const results = await Promise.allSettled(calls)
    expect(results.every((item) => item.status === "rejected")).toBe(true)
    const afterShutdown = await rejection(
      runner.insert({ table: "ok", values: {} })
    )
    expect(afterShutdown.httpStatus).toBe(500)
  })
})

describe("mutation runner with the real worker", () => {
  it("inserts, updates and deletes through the real worker", async () => {
    runner = createMutationRunner({
      env: { ...process.env, MAC_MANAGER_DB_FILE: file },
    })

    const inserted = await runner.insert({
      table: "items",
      values: { name: { type: "text", value: "apple" } },
    })
    expect(inserted.record.values.name).toEqual({
      type: "text",
      value: "apple",
    })

    const updated = await runner.update({
      table: "items",
      key: inserted.record.key,
      expectedSignature: inserted.record.signature,
      values: { note: { type: "text", value: "x" } },
    })
    expect(updated.record.values.note).toEqual({
      type: "text",
      value: "x",
    })
    expect(updated.record.signature).not.toBe(inserted.record.signature)

    const deleted = await runner.delete({
      table: "items",
      items: [
        {
          key: updated.record.key,
          expectedSignature: updated.record.signature,
        },
      ],
    })
    expect(deleted.deleted).toEqual([updated.record.key])

    // 用读侧确认真的写进去了又删干净了
    const reader = openDatabase({ file, mode: "readonly" })
    try {
      expect(() =>
        getRecord(reader, {
          table: "items",
          key: inserted.record.key,
        })
      ).toThrow()
    } finally {
      closeDatabase(reader)
    }
  }, 30_000)
})
