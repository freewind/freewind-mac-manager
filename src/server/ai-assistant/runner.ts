import { randomUUID } from "node:crypto"
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent"
import { PublicOperationError } from "@server/common/public-error"
import { beginSessionRun, endSessionRun, onSessionDisposed } from "./session"
import {
  findSessionByRequestId,
  finishSessionRun,
  saveSessionAnswer,
  startSessionRun,
} from "./store"
import type { StreamableSession } from "./stream"

/**
 * 服务端执行运行器：执行的所有权在服务端，不在 HTTP 连接上。
 *
 * 浏览器只是订阅者。手机切后台、锁屏、关标签页、刷新或弱网断线只会解除订阅，
 * 不会中止 Agent 及其工具子进程；重新连上按执行标识订阅，就能拿到同一执行
 * 已经发生的事件与最终结果。
 *
 * 取消只由两个受控入口触发：显式停止（stopExecution）与服务关闭时的会话清理
 * （onSessionDisposed）。断线永远不触发取消。
 */

/** 执行终态。用户主动停止同样归到 unknown：结果一样无法确认。 */
export type ExecutionStatus = "running" | "done" | "unknown"

/**
 * 每个执行保留的事件上限。超长执行的早期增量允许被丢掉，
 * 终态与最终回答始终能从状态查询与历史里拿到，所以重放只保证“最近一段”。
 */
const EXECUTION_EVENT_LIMIT = 2000

/** 结束后的执行保留多久：给重连的订阅者留出回读进度与结果的时间窗。 */
const EXECUTION_RETENTION_MS = 10 * 60 * 1000

/** 历史保存失败时给用户看的说明；具体错误只进脱敏日志。 */
const HISTORY_FAILED_DONE = "回答已完成，但会话历史保存失败"
const HISTORY_FAILED_UNKNOWN = "结果未知，且会话历史保存失败"

/** 事件与 SSE 帧一一对应：帧名就是 type，data 就是负载，线上格式保持不变。 */
export type ExecutionEvent =
  | { type: "delta"; data: { type: "text" | "thinking"; delta: string } }
  | {
      type: "tool"
      data: {
        id: string
        name: string
        status: "running" | "done" | "error"
        input?: unknown
        output?: unknown
      }
    }
  | { type: "message_end"; data: { role: string } }
  | { type: "error"; data: { message: string } }
  | {
      type: "done"
      data: { status: "done" | "unknown"; sessionId: string; message?: string }
    }

export type ExecutionSnapshot = {
  id: string
  sessionId: string
  status: ExecutionStatus
  /** 是否被受控入口中止（显式停止或会话被丢弃）。 */
  cancelled: boolean
  prompt: string
  answer: string | null
  message: string | null
  startedAt: number
  finishedAt: number | null
  /** 当前缓冲的事件条数；重放时最多这么多。 */
  eventCount: number
}

export type ExecutionObserver = {
  onEvent: (event: ExecutionEvent) => void
  /** 执行结束（含订阅时就已经结束）：订阅方据此收尾，不必自己猜。 */
  onEnd: () => void
}

/**
 * 执行落库的适配层。
 *
 * AI 助手与 AI 话题的会话表不同，但执行生命周期完全一致：把写入点抽出来，
 * 话题就能复用同一个运行器，而不必再写一套执行、重连与停止逻辑。
 */
export type ExecutionPersistence = {
  /** 这个请求标识是否已经提交过：重启后内存没记录也不能重跑。 */
  hasRequest: (requestId: string) => boolean
  startRun: (
    sessionId: string,
    userMessage: { role: "user"; text: string },
    requestId: string | null
  ) => void
  saveAnswer: (sessionId: string, answer: string) => void
  finishRun: (
    sessionId: string,
    status: "done" | "unknown",
    answer?: string | null
  ) => void
  /** 保存会话上下文（话题用）。失败表示上下文未保存，要如实告知。 */
  saveContext?: (sessionId: string) => void
}

/** 默认适配层：AI 助手自己的会话表。 */
export const assistantPersistence: ExecutionPersistence = {
  hasRequest: (requestId) => findSessionByRequestId(requestId) !== null,
  startRun: (sessionId, userMessage, requestId) => {
    startSessionRun(sessionId, userMessage, requestId)
  },
  saveAnswer: (sessionId, answer) => {
    saveSessionAnswer(sessionId, answer)
  },
  finishRun: (sessionId, status, answer) => {
    finishSessionRun(sessionId, status, answer)
  },
}

type Execution = {
  id: string
  sessionId: string
  requestId: string | null
  prompt: string
  session: StreamableSession
  persistence: ExecutionPersistence
  status: ExecutionStatus
  cancelled: boolean
  cancelMessage: string | null
  answer: string | null
  message: string | null
  startedAt: number
  finishedAt: number | null
  events: ExecutionEvent[]
  observers: Set<ExecutionObserver>
  finished: boolean
}

const executions = new Map<string, Execution>()
/** 请求标识 → 执行：重复提交据此复用同一次执行，不产生第二次副作用。 */
const byRequestId = new Map<string, string>()
/** 会话 → 正在跑的执行：同一会话同时只允许一次执行。 */
const runningBySession = new Map<string, string>()

const toSnapshot = (execution: Execution): ExecutionSnapshot => ({
  id: execution.id,
  sessionId: execution.sessionId,
  status: execution.status,
  cancelled: execution.cancelled,
  prompt: execution.prompt,
  answer: execution.answer,
  message: execution.message,
  startedAt: execution.startedAt,
  finishedAt: execution.finishedAt,
  eventCount: execution.events.length,
})

/** 已经结束的执行只保留一段时间：长期挂着只会白占内存。 */
const evictExpired = (now: number): void => {
  for (const [id, execution] of executions) {
    if (!execution.finished) continue
    if (now - (execution.finishedAt ?? now) <= EXECUTION_RETENTION_MS) continue
    executions.delete(id)
    if (execution.requestId) byRequestId.delete(execution.requestId)
  }
}

const emit = (execution: Execution, event: ExecutionEvent): void => {
  execution.events.push(event)
  if (execution.events.length > EXECUTION_EVENT_LIMIT) {
    execution.events.splice(0, execution.events.length - EXECUTION_EVENT_LIMIT)
  }
  for (const observer of execution.observers) observer.onEvent(event)
}

const complete = (
  execution: Execution,
  status: ExecutionStatus,
  message: string | null
): void => {
  execution.status = status
  execution.message = message
  execution.finishedAt = Date.now()
  execution.finished = true
  runningBySession.delete(execution.sessionId)
  const observers = [...execution.observers]
  execution.observers.clear()
  for (const observer of observers) observer.onEnd()
}

/** 已经拿到的部分回答；会话被回收时取不到就是 null。 */
const lastAssistantText = (session: StreamableSession): string | null => {
  try {
    return session.getLastAssistantText() ?? null
  } catch {
    return null
  }
}

const toExecutionEvents = (event: AgentSessionEvent): ExecutionEvent[] => {
  if (event.type === "message_update") {
    const update = event.assistantMessageEvent
    if (update.type === "text_delta") {
      return [{ type: "delta", data: { type: "text", delta: update.delta } }]
    }
    if (update.type === "thinking_delta") {
      return [
        { type: "delta", data: { type: "thinking", delta: update.delta } },
      ]
    }
    return []
  }
  if (event.type === "tool_execution_start") {
    return [
      {
        type: "tool",
        data: {
          id: event.toolCallId,
          name: event.toolName,
          status: "running",
          input: event.args,
        },
      },
    ]
  }
  if (event.type === "tool_execution_end") {
    return [
      {
        type: "tool",
        data: {
          id: event.toolCallId,
          name: event.toolName,
          status: event.isError ? "error" : "done",
          output: event.result,
        },
      },
    ]
  }
  if (event.type === "message_end") {
    return [{ type: "message_end", data: { role: event.message.role } }]
  }
  return []
}

/**
 * 写终态。历史写不进去不能假装一切正常：记一条脱敏日志，
 * 并把「历史保存失败」明确告诉用户（不记录任何提示词内容）。
 */
const persistFinish = (
  execution: Execution,
  status: "done" | "unknown"
): string | null => {
  try {
    execution.persistence.finishRun(
      execution.sessionId,
      status,
      execution.answer
    )
    // 上下文保存失败与终态保存失败一样重要：不保存就等于下次继续对话
    // 丢掉这次的所有内容，必须让用户看到。
    execution.persistence.saveContext?.(execution.sessionId)
    return null
  } catch (error) {
    console.error(
      `[mac-manager] AI 助手历史保存失败（会话 ${execution.sessionId}，终态 ${status}）：${
        error instanceof Error ? error.message : "未知错误"
      }`
    )
    return status === "done" ? HISTORY_FAILED_DONE : HISTORY_FAILED_UNKNOWN
  }
}

/** 执行过程中持续落盘：写库失败只记日志，不能因此中断执行。 */
const persistAnswer = (execution: Execution): void => {
  const answer = lastAssistantText(execution.session)
  if (!answer) return
  execution.answer = answer
  try {
    execution.persistence.saveAnswer(execution.sessionId, answer)
  } catch (error) {
    console.error(
      `[mac-manager] AI 助手中间结果落盘失败（会话 ${execution.sessionId}）：${
        error instanceof Error ? error.message : "未知错误"
      }`
    )
  }
}

/**
 * 后台跑完一次执行。这个函数不持有任何 response：调用方断开连接不影响它，
 * 执行照样跑到终态并落库。
 */
const runExecution = async (execution: Execution): Promise<void> => {
  const { session, sessionId } = execution
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    for (const mapped of toExecutionEvents(event)) emit(execution, mapped)
    if (event.type === "message_end" && event.message.role === "assistant") {
      persistAnswer(execution)
    }
  })

  let status: ExecutionStatus = "unknown"
  let message: string | null = null
  try {
    await session.prompt(execution.prompt)
    execution.answer = lastAssistantText(session)
    if (execution.cancelled) {
      message =
        persistFinish(execution, "unknown") ??
        execution.cancelMessage ??
        "已停止，结果未知"
    } else {
      status = "done"
      message = persistFinish(execution, "done")
    }
  } catch (error) {
    emit(execution, {
      type: "error",
      data: {
        message:
          error instanceof Error
            ? error.message
            : "助手执行失败，请重新读取确认",
      },
    })
    execution.answer = lastAssistantText(session)
    message =
      persistFinish(execution, "unknown") ??
      (execution.cancelled
        ? (execution.cancelMessage ?? "已停止，结果未知")
        : "执行未完成，结果未知")
  } finally {
    unsubscribe()
    endSessionRun(sessionId)
  }

  emit(execution, {
    type: "done",
    data: {
      status: status === "done" ? "done" : "unknown",
      sessionId,
      ...(message ? { message } : {}),
    },
  })
  complete(execution, status, message)
}

export type StartExecutionInput = {
  session: StreamableSession
  sessionId: string
  prompt: string
  requestId?: string | null
  /** 不传时按 AI 助手自己的会话表落库。 */
  persistence?: ExecutionPersistence
}

export type StartExecutionResult = {
  execution: ExecutionSnapshot
  /** true 表示复用了同一请求标识已有的执行，本次没有产生第二次副作用。 */
  reused: boolean
}

/**
 * 提交一次执行。
 *
 * - 同一请求标识只执行一次：已有执行直接复用，调用方拿它去重放事件；
 * - 同一会话已有在途执行（不同请求标识）→ 409，且明确告知没有开始执行；
 * - 先落库（用户指令、running、请求标识）再发请求，写不进去就不开始跑。
 */
export const startExecution = (
  input: StartExecutionInput
): StartExecutionResult => {
  const now = Date.now()
  evictExpired(now)

  const persistence = input.persistence ?? assistantPersistence
  const requestId = input.requestId ?? null
  if (requestId) {
    const existingId = byRequestId.get(requestId)
    const existing = existingId ? executions.get(existingId) : undefined
    if (existing) return { execution: toSnapshot(existing), reused: true }
    // 重启后内存里没有执行记录，但库里已经记过这个请求标识：不能再跑第二次。
    if (persistence.hasRequest(requestId)) {
      throw new PublicOperationError(
        409,
        "该请求标识已经提交过，结果未知，不能重复执行"
      )
    }
  }

  if (!beginSessionRun(input.sessionId)) {
    throw new PublicOperationError(
      409,
      "该会话正在执行中，请等待结束或新建对话"
    )
  }

  const execution: Execution = {
    id: `exec-${randomUUID()}`,
    sessionId: input.sessionId,
    requestId,
    prompt: input.prompt,
    session: input.session,
    persistence,
    status: "running",
    cancelled: false,
    cancelMessage: null,
    answer: null,
    message: null,
    startedAt: now,
    finishedAt: null,
    events: [],
    observers: new Set(),
    finished: false,
  }

  try {
    persistence.startRun(
      input.sessionId,
      { role: "user", text: input.prompt },
      requestId
    )
  } catch (error) {
    endSessionRun(input.sessionId)
    throw error
  }

  executions.set(execution.id, execution)
  if (requestId) byRequestId.set(requestId, execution.id)
  runningBySession.set(input.sessionId, execution.id)

  void runExecution(execution)
  return { execution: toSnapshot(execution), reused: false }
}

export const getExecution = (executionId: string): ExecutionSnapshot => {
  evictExpired(Date.now())
  const execution = executions.get(executionId)
  if (!execution) {
    throw new PublicOperationError(404, "执行不存在或已过期")
  }
  return toSnapshot(execution)
}

/**
 * 按请求标识找已有执行。调用方据此在「重复提交」时跳过建会话等副作用，
 * 保证同一请求标识只产生一次副作用。
 */
export const findExecutionByRequestId = (
  requestId: string
): ExecutionSnapshot | null => {
  evictExpired(Date.now())
  const executionId = byRequestId.get(requestId)
  const execution = executionId ? executions.get(executionId) : undefined
  return execution ? toSnapshot(execution) : null
}

/**
 * 订阅一个执行的事件。
 *
 * 先补齐已经缓冲的事件，再跟上后续增量：断线重连后加入的订阅者同样能看到
 * 当前进度与最终结果。返回的函数只解除订阅，不触碰执行本身。
 */
export const subscribeExecution = (
  executionId: string,
  observer: ExecutionObserver
): (() => void) => {
  evictExpired(Date.now())
  const execution = executions.get(executionId)
  if (!execution) {
    throw new PublicOperationError(404, "执行不存在或已过期")
  }
  for (const event of execution.events) observer.onEvent(event)
  if (execution.finished) {
    observer.onEnd()
    return () => {}
  }
  execution.observers.add(observer)
  return () => {
    execution.observers.delete(observer)
  }
}

/** 显式停止：只有这个入口与会话被丢弃才会取消执行。 */
export const stopExecution = (executionId: string): ExecutionSnapshot => {
  const execution = executions.get(executionId)
  if (!execution) {
    throw new PublicOperationError(404, "执行不存在或已过期")
  }
  if (execution.finished) {
    throw new PublicOperationError(409, "执行已结束，无法停止")
  }
  execution.cancelled = true
  execution.cancelMessage = "已停止，结果未知"
  execution.session.abort()
  return toSnapshot(execution)
}

/** 正在跑的执行的标识；没有则为 null。 */
export const runningExecutionId = (sessionId: string): string | null =>
  runningBySession.get(sessionId) ?? null

/**
 * 会话被丢弃（含服务关闭时的清理）时，正在跑的执行只能按「结果未知」收尾：
 * 丢掉内存会话不等于执行成功，绝不能把它写成 done。
 */
onSessionDisposed((sessionId) => {
  const executionId = runningBySession.get(sessionId)
  const execution = executionId ? executions.get(executionId) : undefined
  if (!execution || execution.finished) return
  execution.cancelled = true
  execution.cancelMessage = "会话已丢弃，结果未知"
  execution.session.abort()
})
