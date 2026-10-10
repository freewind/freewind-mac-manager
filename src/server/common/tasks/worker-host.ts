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
 * - 子进程版（生产/开发实际使用）：把重活放到受控子进程，父进程的计时、鉴权与
 *   任务查询不会被 CPU 或同步 sqlite 业务阻塞。
 * - 内联版（仅测试）：同进程执行，便于用受控替身验证调度逻辑。
 */
export type TaskRunnerHost = {
  execute: (job: TaskJob, context: TaskRunContext) => Promise<TaskOutcome>
}

const STDERR_LIMIT = 4096
const KILL_GRACE_MS = 2000

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
  const waiting: (() => void)[] = []

  const acquire = async (): Promise<void> => {
    if (running < maxConcurrency) {
      running += 1
      return
    }
    await new Promise<void>((resolve) => waiting.push(resolve))
    running += 1
  }

  const release = (): void => {
    running -= 1
    const next = waiting.shift()
    if (next) next()
  }

  const runOnce = (
    job: TaskJob,
    context: TaskRunContext
  ): Promise<TaskOutcome> =>
    new Promise<TaskOutcome>((resolve, reject) => {
      const child = spawn(options.command, options.args, {
        cwd: options.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        // 子进程只消费任务载荷，不继承父进程的额外环境差异。
        env: process.env,
      })

      let outcome: TaskOutcome | null = null
      let failure: string | null = null
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

      const finish = (): void => {
        if (settled) return
        settled = true
        cleanup()
        if (failure !== null) {
          reject(new Error(failure))
          return
        }
        if (outcome) {
          resolve(outcome)
          return
        }
        reject(new Error("执行进程未返回结果就结束，结果未知"))
      }

      context.signal.addEventListener("abort", onAbort, { once: true })

      child.stdout.setEncoding("utf8")
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk
        let index = buffer.indexOf("\n")
        while (index >= 0) {
          const line = buffer.slice(0, index)
          buffer = buffer.slice(index + 1)
          const message = parseWorkerMessage(line)
          if (message?.type === "progress") {
            context.onProgress(message.progress)
          } else if (message?.type === "result") {
            outcome = {
              result: message.result,
              message: message.message,
              status: message.status,
            }
          } else if (message?.type === "failed") {
            failure = message.error
          } else if (line.trim().length > 0) {
            failure = "执行进程返回了无法识别的消息"
          }
          index = buffer.indexOf("\n")
        }
      })

      child.stderr.setEncoding("utf8")
      child.stderr.on("data", (chunk: string) => {
        if (stderr.length < STDERR_LIMIT) stderr += chunk
      })

      child.on("error", (error) => {
        failure = `无法启动执行进程：${error.message}`
        finish()
      })

      child.on("close", (code, signalName) => {
        if (failure === null && outcome === null) {
          const detail = stderr.trim().split("\n").slice(-1)[0] ?? ""
          failure = signalName
            ? `执行进程被信号 ${signalName} 中止，结果未知`
            : `执行进程退出码 ${code}${detail ? `：${detail}` : ""}`
        }
        finish()
      })

      child.stdin.on("error", () => {
        // 子进程可能已在读取前退出；错误由 close 分支统一报告。
      })
      child.stdin.write(`${JSON.stringify(job)}\n`)
      child.stdin.end()
    })

  return {
    execute: async (job, context) => {
      await acquire()
      try {
        return await runOnce(job, context)
      } finally {
        release()
      }
    },
  }
}

export { serializeWorkerMessage }
