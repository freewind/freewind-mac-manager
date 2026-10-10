import { randomUUID } from "node:crypto"
import type { TaskAccepted, TaskProgress } from "@shared/api-contract"
import { describeError } from "@shared/format"
import {
  TASK_HISTORY_KEEP,
  TASK_PROGRESS_THROTTLE_MS,
  TASK_RESPONSE_THRESHOLD_MS,
} from "@shared/task-policy"
import {
  payloadFingerprint,
  type TaskStatus,
  type TaskStore,
  type TaskStoredRow,
} from "./store"
import type { TaskOutcome, TaskRunnerHost } from "./worker-host"
import { TaskHostError } from "./worker-host"

export type TaskSubmitRequest<TBody = unknown> = {
  kind: string
  /** 前端与任务列表展示的业务目标。 */
  target: string
  /** 独立冲突锁；省略时与展示 target 相同。 */
  lockTarget?: string
  payload: unknown
  /** 客户端生成的请求标识；为空表示不是客户端请求发起（如定时任务）。 */
  requestId: string | null
  /** 把完成结果转成该端点自己的完成响应（200/201 与 body）。 */
  toCompletedResponse: (outcome: TaskOutcome) => {
    status: 200 | 201
    body: TBody
  }
}

export type TaskSubmitResult<TBody = unknown> =
  | { kind: "completed"; status: 200 | 201; body: TBody }
  | { kind: "accepted"; body: TaskAccepted }
  /** 目标或请求标识冲突：尚未开始，客户端不应自动重试。 */
  | { kind: "conflict"; message: string }
  /** 动作确实执行了但失败：这是一次真实失败，不是排队冲突。 */
  | { kind: "failed"; message: string }
  /** 结果无法确认（服务中断、响应丢失）：既不能说成功，也不能直接重做。 */
  | { kind: "unknown"; message: string }

type Running = {
  taskId: string
  controller: AbortController
  lastProgressWrite: number
}

const nowSeconds = (): number => Date.now() / 1000

const parseJson = (value: string | null): unknown => {
  if (value === null) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const toOutcome = (row: TaskStoredRow): TaskOutcome => ({
  result: parseJson(row.result),
  message: row.message,
  status: row.status === "partial" ? "partial" : "done",
})

const sameRequest = (options: {
  row: TaskStoredRow
  request: TaskSubmitRequest
  fingerprint: string
  lockTarget: string
}): boolean =>
  options.row.kind === options.request.kind &&
  options.row.target === options.request.target &&
  options.row.lockTarget === options.lockTarget &&
  options.row.requestFingerprint === options.fingerprint

/**
 * 任务运行器（父进程侧）。
 *
 * 职责边界：
 * - 执行前就把任务登记进库，之后才启动执行，保证「请求到达」与「副作用开始」之间有记录。
 * - 阈值只决定这次请求返回真实结果还是受理回执；真正的执行只启动一次。
 * - 终态只写一次，迟到或重复的结束消息会被拒绝。
 * - 不变量：任务表由父进程独占写入，子进程只上报消息。
 */
export class TaskRunner {
  private readonly store: TaskStore
  private readonly host: TaskRunnerHost
  private readonly thresholdMs: number
  private readonly running = new Map<string, Running>()
  private shuttingDown = false

  constructor(options: {
    store: TaskStore
    host: TaskRunnerHost
    thresholdMs?: number
  }) {
    this.store = options.store
    this.host = options.host
    this.thresholdMs = options.thresholdMs ?? TASK_RESPONSE_THRESHOLD_MS
  }

  /** 服务启动时清理上一次进程遗留的运行中任务：它们的结果无法确认。 */
  recoverInterrupted(): number {
    return this.store.markInterrupted(nowSeconds())
  }

  async submit<TBody>(
    request: TaskSubmitRequest<TBody>
  ): Promise<TaskSubmitResult<TBody>> {
    if (this.shuttingDown) {
      return { kind: "conflict", message: "服务正在关闭，未开始新的操作" }
    }

    const fingerprint = payloadFingerprint(request.payload)
    const lockTarget = request.lockTarget ?? request.target

    if (request.requestId) {
      const existing = this.store.findByRequestId(request.requestId)
      if (existing) {
        return this.replay(existing, request, fingerprint, lockTarget)
      }
    }

    const active = this.store.findActive(lockTarget)
    if (active) {
      return {
        kind: "conflict",
        message: "该目标已有任务在执行，请等它结束或先在任务里查看",
      }
    }

    const startedAt = nowSeconds()
    const taskId = randomUUID()
    try {
      this.store.insert({
        id: taskId,
        requestId: request.requestId,
        requestFingerprint: request.requestId ? fingerprint : null,
        kind: request.kind,
        target: request.target,
        lockTarget,
        startedAt,
      })
    } catch (error) {
      // 并发下唯一索引才拦得住：落到这里说明另一个请求已经登记了同一目标或标识。
      const replay = request.requestId
        ? this.store.findByRequestId(request.requestId)
        : null
      if (replay) {
        return this.replay(replay, request, fingerprint, lockTarget)
      }
      return { kind: "conflict", message: describeError(error) }
    }

    // 登记完成之后才真正开始执行。
    const execution = this.execute(taskId, request)
    const raced = await Promise.race([
      execution.then(() => "executed" as const),
      this.delay(this.thresholdMs).then(() => "timeout" as const),
    ])

    if (raced === "timeout") {
      const row = this.store.get(taskId)
      return {
        kind: "accepted",
        body: row
          ? this.acceptedOf(row)
          : { taskId, kind: request.kind, status: "running", startedAt },
      }
    }

    const final = this.store.get(taskId)
    if (!final) {
      return {
        kind: "unknown",
        message: "任务记录丢失，请重新读取目标确认结果",
      }
    }
    if (final.status === "unknown") {
      return {
        kind: "unknown",
        message: final.error ?? "结果无法确认，请重新读取目标",
      }
    }
    if (final.status === "failed") {
      return {
        kind: "failed",
        message: final.error ?? "操作失败",
      }
    }
    return {
      kind: "completed",
      ...request.toCompletedResponse(toOutcome(final)),
    }
  }

  /** 服务关闭：中止仍在执行的子进程，并把它们标成结果未知。 */
  shutdown(): void {
    this.shuttingDown = true
    for (const running of this.running.values()) {
      running.controller.abort()
    }
    this.running.clear()
    this.store.markInterrupted(nowSeconds())
  }

  private replay<TBody>(
    row: TaskStoredRow,
    request: TaskSubmitRequest<TBody>,
    fingerprint: string,
    lockTarget: string
  ): TaskSubmitResult<TBody> {
    if (!sameRequest({ row, request, fingerprint, lockTarget })) {
      return {
        kind: "conflict",
        message: "该请求标识已用于不同任务类型、目标或载荷",
      }
    }
    if (row.status === "running") {
      return { kind: "accepted", body: this.acceptedOf(row) }
    }
    if (row.status === "unknown") {
      return {
        kind: "unknown",
        message: row.error ?? "该请求的结果未知，请重新读取目标确认后再操作",
      }
    }
    if (row.status === "failed") {
      return {
        kind: "failed",
        message: row.error ?? "该请求此前执行失败，未重复执行",
      }
    }
    return {
      kind: "completed",
      ...request.toCompletedResponse(toOutcome(row)),
    }
  }

  private acceptedOf(row: TaskStoredRow): TaskAccepted {
    return {
      taskId: row.id,
      kind: row.kind,
      status: "running",
      startedAt: row.startedAt,
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms)
      timer.unref?.()
    })
  }

  private async execute<TBody>(
    taskId: string,
    request: TaskSubmitRequest<TBody>
  ): Promise<void> {
    const controller = new AbortController()
    const state: Running = {
      taskId,
      controller,
      lastProgressWrite: 0,
    }
    this.running.set(taskId, state)

    try {
      const outcome = await this.host.execute(
        {
          taskId,
          kind: request.kind,
          target: request.target,
          requestId: request.requestId,
          payload: request.payload,
        },
        {
          signal: controller.signal,
          onProgress: (progress) => this.writeProgress(state, progress),
        }
      )
      this.finish(taskId, {
        status: outcome.status,
        result: outcome.result,
        message: outcome.message,
        error: null,
      })
    } catch (error) {
      const status =
        error instanceof TaskHostError
          ? error.status
          : controller.signal.aborted
            ? "unknown"
            : "failed"
      this.finish(taskId, {
        status,
        result: null,
        message: null,
        error: describeError(error),
      })
    } finally {
      this.running.delete(taskId)
    }
  }

  private writeProgress(state: Running, progress: TaskProgress): void {
    const now = Date.now()
    if (now - state.lastProgressWrite < TASK_PROGRESS_THROTTLE_MS) return
    state.lastProgressWrite = now
    this.store.updateProgress(
      state.taskId,
      JSON.stringify(progress),
      nowSeconds()
    )
  }

  private finish(
    taskId: string,
    finish: {
      status: Exclude<TaskStatus, "running">
      result: unknown
      message: string | null
      error: string | null
    }
  ): void {
    this.store.finish(taskId, { ...finish, finishedAt: nowSeconds() })
    this.store.pruneFinished(TASK_HISTORY_KEEP)
  }
}
