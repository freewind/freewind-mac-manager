import { type ChildProcess, spawn } from "node:child_process"
import { mutationWorkerCommand } from "@server/env"
import type {
  DatabaseDeleteResult,
  DatabaseRecordLocatorKey,
  DatabaseRecordResponse,
  SqliteWritableValue,
} from "@shared/api-contract"
import {
  DatabaseDeleteResultSchema,
  DatabaseRecordResponseSchema,
} from "@shared/api-contract"
import {
  DatabaseMutationError,
  type MutationJob,
  parseMutationMessage,
} from "./mutation-protocol"

/**
 * 写运行器（父进程侧）：每个写操作一个一次性子进程，因此超时能靠终止进程硬性
 * 生效，长触发器和锁等待都不会卡住主进程。
 *
 * 单写并发、队列 8、5 秒上限。超时或进程异常退出时返回 executionStatus=unknown，
 * 表示可能已经提交、也可能没有，必须靠后续读取确认，绝不自动重发。
 */
export const MUTATION_TIMEOUT_MS = 5000
export const MUTATION_MAX_CONCURRENCY = 1
export const MUTATION_QUEUE_LIMIT = 8

const STDERR_LIMIT = 4096
const KILL_GRACE_MS = 2000

const RESULT_SCHEMAS = {
  insert: DatabaseRecordResponseSchema,
  update: DatabaseRecordResponseSchema,
  delete: DatabaseDeleteResultSchema,
} as const

export type MutationInsertInput = {
  table: string
  values: Record<string, SqliteWritableValue>
}

export type MutationUpdateInput = {
  table: string
  key: DatabaseRecordLocatorKey
  expectedSignature: string
  values: Record<string, SqliteWritableValue>
}

export type MutationDeleteInput = {
  table: string
  items: Array<{
    key: DatabaseRecordLocatorKey
    expectedSignature: string
  }>
}

export type DatabaseMutationRunner = {
  insert: (input: MutationInsertInput) => Promise<DatabaseRecordResponse>
  update: (input: MutationUpdateInput) => Promise<DatabaseRecordResponse>
  delete: (input: MutationDeleteInput) => Promise<DatabaseDeleteResult>
  /** 当前并发与排队数量，用于测试与诊断。 */
  stats: () => { running: number; queued: number }
  shutdown: () => void
}

export type DatabaseMutationRunnerOptions = {
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
  reject: (error: DatabaseMutationError) => void
}

export const createMutationRunner = (
  options: DatabaseMutationRunnerOptions = {}
): DatabaseMutationRunner => {
  const worker = mutationWorkerCommand()
  const command = options.command ?? worker.command
  const args = options.args ?? worker.args
  const cwd = options.cwd ?? worker.cwd
  const env = options.env ?? process.env
  const maxConcurrency = options.maxConcurrency ?? MUTATION_MAX_CONCURRENCY
  const queueLimit = options.queueLimit ?? MUTATION_QUEUE_LIMIT
  const timeoutMs = options.timeoutMs ?? MUTATION_TIMEOUT_MS

  let running = 0
  let closed = false
  const waiting: Waiter[] = []
  const children = new Set<ChildProcess>()

  const acquire = (): Promise<void> => {
    if (closed) {
      return Promise.reject(new DatabaseMutationError(500, "写运行器已关闭"))
    }
    if (running < maxConcurrency) {
      running += 1
      return Promise.resolve()
    }
    if (waiting.length >= queueLimit) {
      return Promise.reject(
        new DatabaseMutationError(429, "写入请求过多，请稍后重试")
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

  const runOnce = (job: MutationJob): Promise<unknown> =>
    new Promise<unknown>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env,
      })
      children.add(child)

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
        killChild(child)
        finish()
      }

      const fail = (error: DatabaseMutationError): void => {
        settle(() => reject(error))
      }

      // 超时不等于失败：进程可能已经把事务提交了，所以按结果未知上报
      timeout = setTimeout(() => {
        fail(
          new DatabaseMutationError(
            500,
            `写入超过 ${timeoutMs} 毫秒，结果未知，请重新读取确认`,
            "unknown"
          )
        )
      }, timeoutMs)

      const handleLine = (line: string): void => {
        const message = parseMutationMessage(line)
        if (!message) {
          protocolFailure ??= "写入进程返回了无法识别的消息"
          return
        }
        if (message.type === "failed") {
          fail(
            new DatabaseMutationError(
              message.httpStatus,
              message.error,
              message.executionStatus
            )
          )
          return
        }
        const parsed = RESULT_SCHEMAS[job.kind].safeParse(message.result)
        if (!parsed.success) {
          fail(
            new DatabaseMutationError(
              500,
              "写入进程返回的结果不符合契约，结果未知，请重新读取确认",
              "unknown"
            )
          )
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
        // 进程都没起来，可以确定没有写入
        fail(new DatabaseMutationError(500, "无法启动写入进程"))
      })

      child.on("close", (code, signalName) => {
        children.delete(child)
        if (stderr.trim().length > 0) {
          console.error(`[mac-manager] 数据库写子进程输出：${stderr.trim()}`)
        }
        if (settled) return
        if (buffer.trim().length > 0) handleLine(buffer)
        if (settled) return
        // 没拿到终态消息就退出了：事务状态无法确认
        fail(
          new DatabaseMutationError(
            500,
            protocolFailure
              ? "写入进程返回了无法识别的消息，结果未知，请重新读取确认"
              : signalName
                ? `写入进程被信号 ${signalName} 中止，结果未知，请重新读取确认`
                : `写入进程未返回结果就退出了（退出码 ${code}），结果未知，请重新读取确认`,
            "unknown"
          )
        )
      })

      child.stdin?.on("error", () => {
        // 子进程可能已在读取前退出；错误由 close 分支统一报告。
      })
      child.stdin?.write(`${JSON.stringify(job)}\n`)
      child.stdin?.end()
    })

  const runJob = async (job: MutationJob): Promise<unknown> => {
    await acquire()
    try {
      return await runOnce(job)
    } finally {
      release()
    }
  }

  return {
    insert: async (input) =>
      (await runJob({
        kind: "insert",
        table: input.table,
        values: input.values,
      })) as DatabaseRecordResponse,
    update: async (input) =>
      (await runJob({
        kind: "update",
        table: input.table,
        key: input.key,
        expectedSignature: input.expectedSignature,
        values: input.values,
      })) as DatabaseRecordResponse,
    delete: async (input) =>
      (await runJob({
        kind: "delete",
        table: input.table,
        items: input.items,
      })) as DatabaseDeleteResult,
    stats: () => ({ running, queued: waiting.length }),
    shutdown: () => {
      closed = true
      for (const waiter of waiting.splice(0)) {
        waiter.reject(new DatabaseMutationError(500, "写运行器已关闭"))
      }
      for (const child of children) killChild(child)
      children.clear()
    },
  }
}
