import {
  runScanTask,
  SCAN_KIND,
  ScanPayloadSchema,
} from "@server/disk-growth/task"
import type { TaskProgress } from "@shared/api-contract"

export type TaskExecutorOutcome = {
  result: unknown
  message?: string | null
  status?: "done" | "partial"
}

export type TaskExecutorContext = {
  /** 上报真实进度：只统计已经确认完成的处理动作。 */
  report: (progress: TaskProgress) => void
}

/**
 * 子进程侧的任务实现。父进程只按 kind 在前述注册表里查表，
 * 载荷不能指定模块、命令或 shell 片段。
 */
export type TaskExecutor = {
  kind: string
  run: (
    payload: unknown,
    context: TaskExecutorContext
  ) => Promise<TaskExecutorOutcome>
}

export type TaskExecutorRegistry = {
  get: (kind: string) => TaskExecutor | null
  kinds: () => string[]
}

export const createExecutorRegistry = (
  executors: TaskExecutor[]
): TaskExecutorRegistry => {
  const map = new Map(executors.map((executor) => [executor.kind, executor]))
  return {
    get: (kind) => map.get(kind) ?? null,
    kinds: () => [...map.keys()],
  }
}

/**
 * 各域的实现按接入顺序登记在这里；未登记的 kind 直接报错。
 * 载荷必须先按该种类自己的 schema 校验，再交给实现。
 */
export const taskExecutors: TaskExecutor[] = [
  {
    kind: SCAN_KIND,
    run: async (payload, context) => {
      const parsed = ScanPayloadSchema.safeParse(payload)
      if (!parsed.success) throw new Error("扫描任务载荷非法")
      const outcome = await runScanTask({
        root: parsed.data.root,
        report: context.report,
      })
      return {
        result: outcome.result,
        message: outcome.message,
        // 有不可读项时如实报部分完成，不报成完整成功。
        status: outcome.incomplete ? "partial" : "done",
      }
    },
  },
]
