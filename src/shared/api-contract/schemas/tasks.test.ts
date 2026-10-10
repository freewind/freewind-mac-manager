import { describe, expect, it } from "vitest"
import { TaskAcceptedSchema, TaskRequestIdHeadersSchema } from "./common"
import {
  TASK_KINDS,
  TaskListQuerySchema,
  TaskListResponseSchema,
  TaskProgressSchema,
  TaskRecordSchema,
} from "./tasks"

const baseTask = {
  id: "task-1",
  requestId: "req-0123456789abcdef",
  target: "/",
  status: "running" as const,
  progress: null,
  message: null,
  error: null,
  startedAt: 1000,
  finishedAt: null,
  updatedAt: 1000,
}

describe("task schemas", () => {
  it("only accepts url-safe request ids", () => {
    expect(
      TaskRequestIdHeadersSchema.safeParse({
        "x-task-request-id": "req-0123456789abcdef",
      }).success
    ).toBe(true)
    expect(
      TaskRequestIdHeadersSchema.safeParse({ "x-task-request-id": "short" })
        .success
    ).toBe(false)
    expect(
      TaskRequestIdHeadersSchema.safeParse({
        "x-task-request-id": "req 0123456789abcdef",
      }).success
    ).toBe(false)
  })

  it("treats the accepted reply as unfinished work", () => {
    expect(
      TaskAcceptedSchema.safeParse({
        taskId: "task-1",
        kind: "disk_scan",
        status: "running",
        startedAt: 1000,
      }).success
    ).toBe(true)
    // 受理回执不能冒充已完成状态
    expect(
      TaskAcceptedSchema.safeParse({
        taskId: "task-1",
        kind: "disk_scan",
        status: "done",
        startedAt: 1000,
      }).success
    ).toBe(false)
  })

  it("keeps progress numbers nullable when the total is unknown", () => {
    expect(
      TaskProgressSchema.safeParse({
        done: 12,
        total: null,
        bytesDone: 2048,
        bytesTotal: null,
        stage: "统计文件",
        currentTarget: "/Users/demo",
      }).success
    ).toBe(true)
    expect(
      TaskProgressSchema.safeParse({
        done: -1,
        total: null,
        bytesDone: null,
        bytesTotal: null,
        stage: "统计文件",
        currentTarget: null,
      }).success
    ).toBe(false)
  })

  it("binds each task kind to its own result structure", () => {
    expect(
      TaskRecordSchema.safeParse({
        ...baseTask,
        kind: "disk_scan",
        result: { snapshotId: 7, fileCount: 10, dirCount: 2, totalSize: 100 },
      }).success
    ).toBe(true)
    expect(
      TaskRecordSchema.safeParse({
        ...baseTask,
        kind: "file_delete",
        result: {
          completed: ["/tmp/a"],
          failed: [{ path: "/tmp/b", message: "权限不足" }],
          skipped: [],
          bytes: null,
        },
      }).success
    ).toBe(true)
    // 结果结构必须匹配任务种类，禁止任意 JSON
    expect(
      TaskRecordSchema.safeParse({
        ...baseTask,
        kind: "disk_scan",
        result: { completed: [], failed: [], skipped: [], bytes: null },
      }).success
    ).toBe(false)
    expect(
      TaskRecordSchema.safeParse({
        ...baseTask,
        kind: "unknown_kind",
        result: null,
      }).success
    ).toBe(false)
  })

  it.each(Object.values(TASK_KINDS))(
    "accepts every registered kind in queryable states: %s",
    (kind) => {
      for (const status of ["running", "done", "failed", "unknown"]) {
        expect(
          TaskRecordSchema.safeParse({
            ...baseTask,
            kind,
            status,
            result: null,
          }).success
        ).toBe(true)
      }
    }
  )

  it.each([
    TASK_KINDS.serviceAction,
    TASK_KINDS.diskEntryReveal,
    TASK_KINDS.diskEntryTrash,
  ])("validates action results for %s", (kind) => {
    expect(
      TaskRecordSchema.safeParse({
        ...baseTask,
        kind,
        status: "done",
        result: { message: "动作已完成" },
      }).success
    ).toBe(true)
    expect(
      TaskRecordSchema.safeParse({ ...baseTask, kind, result: { removed: 1 } })
        .success
    ).toBe(false)
  })

  it("accepts an empty result before the task finishes", () => {
    expect(
      TaskRecordSchema.safeParse({
        ...baseTask,
        kind: "file_move",
        status: "running",
        result: null,
      }).success
    ).toBe(true)
  })

  it("defaults list query filters and enforces page bounds", () => {
    expect(
      TaskListQuerySchema.parse({}) satisfies Record<string, unknown>
    ).toMatchInlineSnapshot(`
      {
        "page": 1,
        "pageSize": 20,
        "status": "active",
      }
    `)
    expect(TaskListQuerySchema.safeParse({ pageSize: 500 }).success).toBe(false)
  })

  it("returns a paged task list", () => {
    expect(
      TaskListResponseSchema.safeParse({
        tasks: [{ ...baseTask, kind: "file_copy", result: null }],
        page: 1,
        pageSize: 20,
        total: 1,
      }).success
    ).toBe(true)
    expect(
      TaskListResponseSchema.safeParse({
        tasks: [],
        page: 0,
        pageSize: 20,
        total: 0,
      }).success
    ).toBe(false)
  })
})
