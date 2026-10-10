import { spawn } from "node:child_process"
import type { TaskProgress } from "@shared/api-contract"
import { TASK_MAX_CONCURRENCY } from "@shared/task-policy"
import {
  parseWorkerMessage,
  serializeWorkerMessage,
  type WorkerJob,
} from "./worker-protocol"

export type TaskJob = WorkerJob

export type TaskOutcome = {
  result: unknown
  message: string | null
  status: "done" | "partial"
}

export type TaskRunContext = {
  onProgress: (progress: TaskProgress) => void
  signal: AbortSignal
}

/**
 * 执行一个任务并把它做完。实现分两种：
 * - 子进程版（生产/开发实际使用）：把重活放到受控子进程，父进程的计时与
 *   任务查询不会被 CPU 或同步 sqlite 业务阻塞。
 * - 内联版（仅测试）：同进程执行，便于用受控替身验证调度逻辑。
 */
export type TaskRunnerHost = {
  execute: (job: TaskJob, context: TaskRunContext) => Promise<TaskOutcome>
}

const STDERR_LIMIT = 4096
const KILL_GRACE_MS = 2000

export class TaskHostError extends Error {
  constructor(
    readonly status: "failed" | "unknown",
    message: string
  ) {
    super(message)
    this.name = "TaskHostError"
  }
}

type WaitingJob = {
  resolve: () => void
  reject: (error: TaskHostError) => void
  signal: AbortSignal
  onAbort: () => void
}

const ABORTED_BEFORE_START = "任务在执行前已中止，未启动执行进程"

/** 测试用：同进程执行，不启动子进程。 */
export const createInlineHost = (
  execute: TaskRunnerHost["execute"]
): TaskRunnerHost => ({ execute })

export const createProcessHost = (options: {
  command: string
  args: string[]
  cwd?: string
  maxConcurrency?: number
}): TaskRunnerHost => {
  const maxConcurrency = options.maxConcurrency ?? TASK_MAX_CONCURRENCY
  let running = 0
  const waiting: WaitingJob[] = []

  const acquire = (signal: AbortSignal): Promise<void> => {
    if (signal.aborted) {
      return Promise.reject(new TaskHostError("unknown", ABORTED_BEFORE_START))
    }
    if (running < maxConcurrency) {
      running += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: WaitingJob = {
        resolve,
        reject,
        signal,
        onAbort: () => {
          const index = waiting.indexOf(waiter)
          if (index >= 0) waiting.splice(index, 1)
          signal.removeEventListener("abort", waiter.onAbort)
          reject(new TaskHostError("unknown", ABORTED_BEFORE_START))
        },
      }
      waiting.push(waiter)
      signal.addEventListener("abort", waiter.onAbort, { once: true })
      if (signal.aborted) waiter.onAbort()
    })
  }

  const release = (): void => {
    const next = waiting.shift()
    if (next) {
      next.signal.removeEventListener("abort", next.onAbort)
      if (next.signal.aborted) {
        next.reject(new TaskHostError("unknown", ABORTED_BEFORE_START))
        release()
        return
      }
      // 把当前并发槽直接交给下一个任务，不减少 running 计数。
      next.resolve()
      return
    }
    running -= 1
  }

  const runOnce = (
    job: TaskJob,
    context: TaskRunContext
  ): Promise<TaskOutcome> =>
    new Promise<TaskOutcome>((resolve, reject) => {
      if (context.signal.aborted) {
        reject(new TaskHostError("unknown", ABORTED_BEFORE_START))
        return
      }
      const child = spawn(options.command, options.args, {
        cwd: options.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        // 子进程只消费任务载荷，不继承父进程的额外环境差异。
        env: process.env,
      })

      let outcome: TaskOutcome | null = null
      let declaredFailure: string | null = null
      let protocolFailure: string | null = null
      let processFailure: TaskHostError | null = null
      let stderr = ""
      let buffer = ""
      let settled = false
      let killTimer: NodeJS.Timeout | null = null

      const cleanup = (): void => {
        if (killTimer) clearTimeout(killTimer)
        killTimer = null
        context.signal.removeEventListener("abort", onAbort)
      }

      const onAbort = (): void => {
        child.kill("SIGTERM")
        killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS)
      }

      const finishWithError = (error: TaskHostError): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }

      const handleLine = (line: string): void => {
        if (line.trim().length === 0) return
        const message = parseWorkerMessage(line)
        if (!message) {
          protocolFailure ??= "执行进程返回了无法识别的消息"
          return
        }
        if (outcome || declaredFailure) {
          protocolFailure ??= "执行进程在终态消息后又返回了消息"
          return
        }
        if (message.type === "progress") {
          context.onProgress(message.progress)
        } else if (message.type === "result") {
          outcome = {
            result: message.result,
            message: message.message,
            status: message.status,
          }
        } else {
          declaredFailure = message.error
        }
      }

      const finish = (
        code: number | null,
        signalName: NodeJS.Signals | null
      ): void => {
        if (settled) return
        settled = true
        cleanup()
        if (protocolFailure) {
          reject(new TaskHostError("unknown", protocolFailure))
          return
        }
        if (processFailure) {
          reject(processFailure)
          return
        }
        if (declaredFailure !== null && outcome === null) {
          reject(new TaskHostError("failed", declaredFailure))
          return
        }
        if (outcome && code === 0 && signalName === null) {
          resolve(outcome)
          return
        }
        const detail = stderr.trim().split("\n").slice(-1)[0] ?? ""
        if (outcome) {
          reject(
            new TaskHostError(
              "unknown",
              `执行进程在返回结果后异常结束${signalName ? `（信号 ${signalName}）` : `（退出码 ${code}）`}${detail ? `：${detail}` : ""}`
            )
          )
          return
        }
        reject(
          new TaskHostError(
            "unknown",
            `执行进程未返回结果${signalName ? `就被信号 ${signalName} 中止` : `就以退出码 ${code} 结束`}${detail ? `：${detail}` : ""}`
          )
        )
      }
      child.stdout.setEncoding("utf8")
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk
        let index = buffer.indexOf("\n")
        while (index >= 0) {
          handleLine(buffer.slice(0, index))
          buffer = buffer.slice(index + 1)
          index = buffer.indexOf("\n")
        }
      })

      child.stderr.setEncoding("utf8")
      child.stderr.on("data", (chunk: string) => {
        if (stderr.length < STDERR_LIMIT) stderr += chunk
      })

      child.on("error", (error) => {
        const status = child.pid === undefined ? "failed" : "unknown"
        processFailure = new TaskHostError(
          status,
          `${child.pid === undefined ? "无法启动" : "执行进程发生错误"}：${error.message}`
        )
        if (child.pid === undefined) finishWithError(processFailure)
      })

      child.on("close", (code, signalName) => {
        if (buffer.trim().length > 0) handleLine(buffer)
        finish(code, signalName)
      })

      child.stdin.on("error", () => {
        // 子进程可能已在读取前退出；错误由 close 分支统一报告。
      })

      context.signal.addEventListener("abort", onAbort, { once: true })
      if (context.signal.aborted) {
        onAbort()
        return
      }
      child.stdin.write(`${JSON.stringify(job)}\n`)
      child.stdin.end()
    })

  return {
    execute: async (job, context) => {
      await acquire(context.signal)
      try {
        if (context.signal.aborted) {
          throw new TaskHostError("unknown", ABORTED_BEFORE_START)
        }
        return await runOnce(job, context)
      } finally {
        release()
      }
    },
  }
}

export { serializeWorkerMessage }
