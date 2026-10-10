import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { payloadFingerprint, TaskStore } from "./store"

let dir: string
let store: TaskStore

beforeEach(() => {
  // 单元测试只写临时数据库，绝不碰真实记录。
  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-tasks-"))
  store = new TaskStore(path.join(dir, "tasks.sqlite3"))
})

afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

const insert = (overrides: Partial<Parameters<TaskStore["insert"]>[0]> = {}) =>
  store.insert({
    id: "task-1",
    requestId: "req-1",
    requestFingerprint: "fp-1",
    kind: "file_delete",
    target: "/tmp/a",
    startedAt: 1000,
    ...overrides,
  })

describe("task store", () => {
  it("reads back a registered task", () => {
    insert()
    const row = store.get("task-1")
    expect(row).not.toBeNull()
    expect(row?.status).toBe("running")
    expect(row?.finishedAt).toBeNull()
    expect(store.findByRequestId("req-1")?.id).toBe("task-1")
    expect(store.get("task-1")?.target).toBe("/tmp/a")
    expect(store.get("task-1")?.lockTarget).toBe("/tmp/a")
  })

  it("allows only one running task per kind and target", () => {
    insert()
    expect(() =>
      insert({ id: "task-2", requestId: "req-2", requestFingerprint: "fp-2" })
    ).toThrow()
    // 终结之后同一目标可以再次执行
    store.finish("task-1", {
      status: "done",
      result: null,
      message: null,
      error: null,
      finishedAt: 1001,
    })
    expect(() =>
      insert({ id: "task-2", requestId: "req-2", requestFingerprint: "fp-2" })
    ).not.toThrow()
  })

  it("migrates the pre-lock schema without changing task targets", () => {
    store.close()
    const db = new DatabaseSync(path.join(dir, "tasks.sqlite3"))
    db.exec(`
      DROP TABLE task_record;
      CREATE TABLE task_record (
        id TEXT PRIMARY KEY,
        request_id TEXT,
        request_fingerprint TEXT,
        kind TEXT NOT NULL,
        target TEXT NOT NULL,
        status TEXT NOT NULL,
        progress TEXT,
        message TEXT,
        error TEXT,
        result TEXT,
        started_at REAL NOT NULL,
        finished_at REAL,
        updated_at REAL NOT NULL
      );
      CREATE UNIQUE INDEX idx_task_record_target
        ON task_record (target) WHERE status = 'running';
      INSERT INTO task_record (
        id, request_id, request_fingerprint, kind, target, status,
        started_at, updated_at
      ) VALUES ('legacy', 'legacy-request', 'legacy-fingerprint',
        'file_delete', 'files:%2Ftmp%2Fa', 'running', 1000, 1000);
    `)
    db.close()

    store = new TaskStore(path.join(dir, "tasks.sqlite3"))
    expect(store.get("legacy")).toMatchObject({
      target: "files:%2Ftmp%2Fa",
      lockTarget: "files:%2Ftmp%2Fa",
      status: "unknown",
    })
    expect(store.get("legacy")?.error).toContain("结果未知")
  })

  it("locks distinct display targets by their explicit lock target", () => {
    insert({
      id: "file-task-a",
      requestId: "file-request-a",
      target: "files:%2Ftmp%2Fa",
      lockTarget: "files:mutations",
    })
    expect(store.findActive("files:mutations")?.target).toBe("files:%2Ftmp%2Fa")
    expect(() =>
      insert({
        id: "file-task-b",
        requestId: "file-request-b",
        target: "files:dir:%2Ftmp%2Fparent",
        lockTarget: "files:mutations",
      })
    ).toThrow()
  })

  it("allows only one task per request id", () => {
    insert()
    expect(() =>
      insert({ id: "task-3", requestId: "req-1", requestFingerprint: "fp-1" })
    ).toThrow()
  })

  it("accepts multiple rows without request ids", () => {
    insert({ id: "task-a", requestId: null, target: "/tmp/a" })
    expect(() =>
      insert({ id: "task-b", requestId: null, target: "/tmp/b" })
    ).not.toThrow()
  })

  it("writes the terminal state only once and rejects late updates", () => {
    insert()
    expect(
      store.finish("task-1", {
        status: "done",
        result: { snapshotId: 1 },
        message: "完成",
        error: null,
        finishedAt: 1002,
      })
    ).toBe(true)
    // 迟到或重复的结束消息
    expect(
      store.finish("task-1", {
        status: "failed",
        result: null,
        message: null,
        error: "晚了",
        finishedAt: 1003,
      })
    ).toBe(false)
    expect(store.updateProgress("task-1", "{}", 1004)).toBe(false)
    const row = store.get("task-1")
    expect(row?.status).toBe("done")
    expect(row?.result).toBe(JSON.stringify({ snapshotId: 1 }))
  })

  it("keeps progress updatable while running", () => {
    insert()
    expect(store.updateProgress("task-1", '{"done":5}', 1001)).toBe(true)
    expect(store.get("task-1")?.progress).toBe('{"done":5}')
  })

  it("marks leftover running tasks as unknown on restart", () => {
    insert()
    expect(store.markInterrupted(2000)).toBe(1)
    const row = store.get("task-1")
    expect(row?.status).toBe("unknown")
    expect(row?.error).toContain("结果未知")
    // 重复调用不会再次改动
    expect(store.markInterrupted(2001)).toBe(0)
  })

  it("prunes finished history but never running tasks", () => {
    for (let index = 0; index < 5; index += 1) {
      insert({
        id: `done-${index}`,
        requestId: `req-done-${index}`,
        target: `/tmp/done-${index}`,
      })
      store.finish(`done-${index}`, {
        status: "done",
        result: null,
        message: null,
        error: null,
        finishedAt: 2000 + index,
      })
    }
    insert({ id: "running", requestId: "req-running", target: "/tmp/running" })

    store.pruneFinished(2)

    const { rows, total } = store.list({
      statuses: ["done", "partial", "failed", "unknown"],
      limit: 50,
      offset: 0,
    })
    expect(total).toBe(2)
    expect(rows.map((row) => row.id).sort()).toEqual(["done-3", "done-4"])
    expect(store.get("running")?.status).toBe("running")
  })

  it("filters by status, kind and request id with paging", () => {
    insert({ id: "t1", requestId: "req-a", target: "/tmp/a" })
    insert({
      id: "t2",
      requestId: "req-b",
      kind: "disk_scan",
      target: "scan:/",
    })
    const active = store.list({ statuses: ["running"], limit: 1, offset: 0 })
    expect(active.total).toBe(2)
    expect(active.rows).toHaveLength(1)

    const byKind = store.list({
      statuses: ["running"],
      kinds: ["disk_scan"],
      limit: 10,
      offset: 0,
    })
    expect(byKind.rows.map((row) => row.id)).toEqual(["t2"])

    const byRequest = store.list({
      statuses: ["running"],
      requestId: "req-a",
      limit: 10,
      offset: 0,
    })
    expect(byRequest.rows.map((row) => row.id)).toEqual(["t1"])
  })
})

describe("payload fingerprint", () => {
  it("ignores key order and changes with content", () => {
    expect(payloadFingerprint({ a: 1, b: [2, 3] })).toBe(
      payloadFingerprint({ b: [2, 3], a: 1 })
    )
    expect(payloadFingerprint({ a: 1 })).not.toBe(payloadFingerprint({ a: 2 }))
    expect(payloadFingerprint(null)).toBe(payloadFingerprint(null))
  })
})
