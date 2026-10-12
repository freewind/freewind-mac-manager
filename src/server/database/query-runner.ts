import { type ChildProcess, spawn } from "node:child_process"
import {
  assertRestoreBarrierOpen,
  type RegisteredDatabaseUser,
  registerDatabaseUser,
} from "@server/common/database-maintenance"
import { databaseQueryWorkerCommand } from "@server/env"
import type {
  DatabaseFilter,
  DatabaseRecordLocatorKey,
  DatabaseRecordResponse,
  DatabaseRecordsResponse,
  DatabaseSort,
  DatabaseTable,
  DatabaseTablesResponse,
} from "@shared/api-contract"
import {
  DatabaseRecordResponseSchema,
  DatabaseRecordsResponseSchema,
  DatabaseTableSchema,
  DatabaseTablesResponseSchema,
} from "@shared/api-contract"
import {
  DatabaseQueryError,
  type DatabaseQueryJob,
  parseDatabaseQueryMessage,
} from "./query-protocol"

/**
 * 查询运行器（父进程侧）：每个查询一个一次性子进程，因此超时可以靠终止进程
 * 硬性生效；同步 sqlite 再慢也不会卡住主进程。
 *
 * 并发 2、排队 8，超出直接 429；5 秒还没结果就终止子进程并报错。
 */
export const DATABASE_QUERY_TIMEOUT_MS = 5000
export const DATABASE_QUERY_MAX_CONCURRENCY = 2
export const DATABASE_QUERY_QUEUE_LIMIT = 8

const STDERR_LIMIT = 4096
const KILL_GRACE_MS = 2000

const RESULT_SCHEMAS = {
  list_tables: DatabaseTablesResponseSchema,
  table_detail: DatabaseTableSchema,
  list_records: DatabaseRecordsResponseSchema,
  get_record: DatabaseRecordResponseSchema,
} as const

export type DatabaseListRecordsInput = {
  table: string
  page: number
  pageSize: number
  filters: DatabaseFilter[]
  sorts: DatabaseSort[]
}

export type DatabaseGetRecordInput = {
  table: string
  key: DatabaseRecordLocatorKey
}

export type DatabaseQueryRunner = {
  listTables: () => Promise<DatabaseTablesResponse>
  getTable: (table: string) => Promise<DatabaseTable>
  listRecords: (
    input: DatabaseListRecordsInput
  ) => Promise<DatabaseRecordsResponse>
  getRecord: (input: DatabaseGetRecordInput) => Promise<DatabaseRecordResponse>
  /** 当前并发与排队数量，用于测试与诊断。 */
  stats: () => { running: number; queued: number }
  shutdown: () => void
}

export type DatabaseQueryRunnerOptions = {
  command?: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  maxConcurrency?: number
  queueLimit?: number
  timeoutMs?: number
}

type Waiter = {
  resolve: () => void
  reject: (error: DatabaseQueryError) => void
}

export const createQueryRunner = (
  options: DatabaseQueryRunnerOptions = {}
): DatabaseQueryRunner => {
  const worker = databaseQueryWorkerCommand()
  const command = options.command ?? worker.command
  const args = options.args ?? worker.args
  const cwd = options.cwd ?? worker.cwd
  const env = options.env ?? process.env
  const maxConcurrency =
    options.maxConcurrency ?? DATABASE_QUERY_MAX_CONCURRENCY
  const queueLimit = options.queueLimit ?? DATABASE_QUERY_QUEUE_LIMIT
  const timeoutMs = options.timeoutMs ?? DATABASE_QUERY_TIMEOUT_MS

  let running = 0
  let closed = false
  const waiting: Waiter[] = []
  const children = new Set<ChildProcess>()

  const acquire = (): Promise<void> => {
    if (closed) {
      return Promise.reject(new DatabaseQueryError(500, "查询运行器已关闭"))
    }
    if (running < maxConcurrency) {
      running += 1
      return Promise.resolve()
    }
    if (waiting.length >= queueLimit) {
      return Promise.reject(
        new DatabaseQueryError(429, "查询请求过多，请稍后重试")
      )
    }
    return new Promise<void>((resolve, reject) => {
      waiting.push({ resolve, reject })
    })
  }

  const release = (): void => {
    const next = waiting.shift()
    if (next) {
      // 槽位直接交给下一个，不减少 running 计数
      next.resolve()
      return
    }
    running -= 1
  }

  const killChild = (child: ChildProcess): void => {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill("SIGTERM")
    const force = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS)
    force.unref()
  }

  const runOnce = (job: DatabaseQueryJob): Promise<unknown> =>
    new Promise<unknown>((resolve, reject) => {
      // 维护屏障：数据库正在恢复时不开子进程，按冲突拒绝；
      // 锁损坏或无法验证同样拒绝（fail-closed）。
      try {
        assertRestoreBarrierOpen()
      } catch (error) {
        reject(
          new DatabaseQueryError(
            409,
            error instanceof Error ? error.message : "数据库维护中"
          )
        )
        return
      }
      const child = spawn(command, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env,
      })
      children.add(child)
      // 登记子进程为数据库使用者：恢复前能发现还有查询在跑。
      let registration: RegisteredDatabaseUser | null = null
      if (child.pid !== undefined) {
        try {
          registration = registerDatabaseUser("query", { pid: child.pid })
        } catch (error) {
          killChild(child)
          reject(
            new DatabaseQueryError(
              500,
              `查询子进程无法登记：${error instanceof Error ? error.message : String(error)}`
            )
          )
          return
        }
      }

      let settled = false
      let timeout: NodeJS.Timeout | null = null
      let buffer = ""
      let stderr = ""
      let protocolFailure: string | null = null

      const settle = (finish: () => void): void => {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        timeout = null
        children.delete(child)
        registration?.unregister()
        killChild(child)
        finish()
      }

      const fail = (error: DatabaseQueryError): void => {
        settle(() => reject(error))
      }

      timeout = setTimeout(() => {
        fail(new DatabaseQueryError(500, `查询超过 ${timeoutMs} 毫秒，已终止`))
      }, timeoutMs)

      const handleLine = (line: string): void => {
        const message = parseDatabaseQueryMessage(line)
        if (!message) {
          protocolFailure ??= "查询进程返回了无法识别的消息"
          return
        }
        if (message.type === "failed") {
          fail(new DatabaseQueryError(message.httpStatus, message.error))
          return
        }
        const parsed = RESULT_SCHEMAS[job.kind].safeParse(message.result)
        if (!parsed.success) {
          fail(new DatabaseQueryError(500, "查询进程返回的结果不符合契约"))
          return
        }
        settle(() => resolve(parsed.data))
      }

      child.stdout?.setEncoding("utf8")
      child.stdout?.on("data", (chunk: string) => {
        buffer += chunk
        let index = buffer.indexOf("\n")
        while (index >= 0) {
          handleLine(buffer.slice(0, index))
          buffer = buffer.slice(index + 1)
          index = buffer.indexOf("\n")
        }
      })
      child.stderr?.setEncoding("utf8")
      child.stderr?.on("data", (chunk: string) => {
        if (stderr.length < STDERR_LIMIT) stderr += chunk
      })

      child.on("error", () => {
        fail(new DatabaseQueryError(500, "无法启动查询进程"))
      })

      child.on("close", (code, signalName) => {
        children.delete(child)
        if (settled) {
          if (stderr.trim().length > 0) {
            console.error(
              `[mac-manager] 数据库查询子进程输出：${stderr.trim()}`
            )
          }
          return
        }
        if (buffer.trim().length > 0) handleLine(buffer)
        if (settled) return
        if (protocolFailure) {
          fail(new DatabaseQueryError(500, protocolFailure))
          return
        }
        if (stderr.trim().length > 0) {
          console.error(`[mac-manager] 数据库查询子进程输出：${stderr.trim()}`)
        }
        fail(
          new DatabaseQueryError(
            500,
            signalName
              ? `查询进程被信号 ${signalName} 中止`
              : `查询进程未返回结果就退出了（退出码 ${code}）`
          )
        )
      })

      child.stdin?.on("error", () => {
        // 子进程可能已在读取前退出；错误由 close 分支统一报告。
      })
      child.stdin?.write(`${JSON.stringify(job)}\n`)
      child.stdin?.end()
    })

  const runJob = async (job: DatabaseQueryJob): Promise<unknown> => {
    await acquire()
    try {
      return await runOnce(job)
    } finally {
      release()
    }
  }

  return {
    listTables: async () =>
      (await runJob({ kind: "list_tables" })) as DatabaseTablesResponse,
    getTable: async (table) =>
      (await runJob({ kind: "table_detail", table })) as DatabaseTable,
    listRecords: async (input) =>
      (await runJob({
        kind: "list_records",
        table: input.table,
        query: {
          page: input.page,
          pageSize: input.pageSize,
          filters: input.filters,
          sorts: input.sorts,
        },
      })) as DatabaseRecordsResponse,
    getRecord: async (input) =>
      (await runJob({
        kind: "get_record",
        table: input.table,
        key: input.key,
      })) as DatabaseRecordResponse,
    stats: () => ({ running, queued: waiting.length }),
    shutdown: () => {
      closed = true
      for (const waiter of waiting.splice(0)) {
        waiter.reject(new DatabaseQueryError(500, "查询运行器已关闭"))
      }
      for (const child of children) killChild(child)
      children.clear()
    },
  }
}
