import { contract, type TaskRecord } from "@shared/api-contract"
import { TaskRecordSchema } from "@shared/api-contract/schemas/tasks"
import { describeError } from "@shared/format"
import { initServer } from "@ts-rest/express"
import type {
  TaskStatus,
  TaskStore,
  TaskStoredRow,
} from "../common/tasks/store"

const s = initServer()

export const tasksContract = {
  listTasks: contract.listTasks,
  getTask: contract.getTask,
}

const ALL_STATUSES: TaskStatus[] = [
  "running",
  "done",
  "partial",
  "failed",
  "unknown",
]

const parseJson = (value: string | null): unknown => {
  if (value === null) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/** 只允许形如 disk_scan 的稳定标识进入查询，避免把任意输入当过滤条件。 */
const KIND_PATTERN = /^[a-z][a-z0-9_]{0,39}$/

/**
 * 把存储行转成契约里的任务记录。
 *
 * 结果里只有路径、数量和标识这类必要信息；原始载荷从不入库，凭据类内容不会
 * 因为任务记录而泄漏。无法通过契约校验的行（例如版本升级遗留）直接不返回。
 */
const toRecord = (row: TaskStoredRow): TaskRecord | null => {
  const parsed = TaskRecordSchema.safeParse({
    id: row.id,
    requestId: row.requestId,
    target: row.target,
    kind: row.kind,
    status: row.status,
    progress: parseJson(row.progress),
    message: row.message,
    error: row.error,
    result: parseJson(row.result),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    updatedAt: row.updatedAt,
  })
  if (!parsed.success) {
    console.warn(`[mac-manager] 任务 ${row.id} 的记录无法通过校验，已跳过返回`)
    return null
  }
  return parsed.data
}

export const createTasksRouter = (store: TaskStore) =>
  s.router(tasksContract, {
    listTasks: async ({ query }) => {
      try {
        const kinds = query.kinds
          ? query.kinds
              .split(",")
              .map((item) => item.trim())
              .filter((item) => KIND_PATTERN.test(item))
          : undefined
        // 传了种类但没一个合法：按“匹配不到”处理，不能退化成不过滤而返回全部。
        if (kinds && kinds.length === 0) {
          return {
            status: 200 as const,
            body: {
              tasks: [],
              page: query.page,
              pageSize: query.pageSize,
              total: 0,
            },
          }
        }
        const { rows, total } = store.list({
          statuses: query.status === "all" ? ALL_STATUSES : ["running"],
          kinds,
          requestId: query.requestId,
          limit: query.pageSize,
          offset: (query.page - 1) * query.pageSize,
        })
        const tasks = rows
          .map(toRecord)
          .filter((record): record is TaskRecord => record !== null)
        return {
          status: 200 as const,
          body: {
            tasks,
            page: query.page,
            pageSize: query.pageSize,
            total,
          },
        }
      } catch (error) {
        return { status: 500 as const, body: { message: describeError(error) } }
      }
    },

    getTask: async ({ params }) => {
      try {
        const row = store.get(params.id)
        const record = row ? toRecord(row) : null
        if (!record) {
          // 没有记录只说明查不到，不能推断该操作没有执行过。
          return {
            status: 404 as const,
            body: { message: "没有找到该任务记录" },
          }
        }
        return { status: 200 as const, body: record }
      } catch (error) {
        return { status: 500 as const, body: { message: describeError(error) } }
      }
    },
  })
