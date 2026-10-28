import type { AgentSession } from "@earendil-works/pi-coding-agent"
import {
  type ExecutionEvent,
  type ExecutionPersistence,
  startExecution,
  subscribeExecution,
} from "./runner"

/** 只依赖会话中确实要用到的能力，便于用受控替身驱动测试。 */
export type StreamableSession = Pick<
  AgentSession,
  "subscribe" | "prompt" | "abort" | "getLastAssistantText"
>

/** 只依赖 SSE 需要的响应能力，不绑定具体框架类型。 */
export type SseResponse = {
  setHeader: (name: string, value: string) => unknown
  flushHeaders: () => unknown
  write: (chunk: string) => unknown
  end: () => unknown
  on: (event: "close", listener: () => void) => unknown
}

/**
 * SSE 是纯订阅/转发层。
 *
 * 执行的生命周期归 runner，跟任何 response 对象无关：连接断开只解除订阅、
 * 停止向该连接写数据，绝不中止 Agent 及其工具子进程。
 * 帧名与负载沿用既有线上格式：delta / tool / message_end / error / done。
 */
const writeEvent = (response: SseResponse, event: ExecutionEvent): void => {
  response.write(
    `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`
  )
}

/**
 * 订阅一个已经存在的执行，把事件转发成 SSE，直到执行结束或连接断开。
 *
 * 订阅前不写 SSE 头：执行不存在时（404）调用方还能回一条普通 JSON 错误。
 * 断线路径只调用退订函数，不触碰执行。
 */
export const streamExecutionEvents = async (
  executionId: string,
  response: SseResponse
): Promise<void> => {
  response.setHeader("Content-Type", "text/event-stream")
  response.setHeader("Cache-Control", "no-cache")
  response.setHeader("Connection", "keep-alive")

  let settled = false
  let unsubscribe = (): void => {}
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      if (settled) return
      settled = true
      resolve()
    }
    response.on("close", () => {
      // 断线只退订：执行继续跑，重新连上还能看到同一执行。
      unsubscribe()
      finish()
    })
    unsubscribe = subscribeExecution(executionId, {
      onEvent: (event) => writeEvent(response, event),
      onEnd: () => {
        response.end()
        finish()
      },
    })
    // 订阅期间可能已经结束（重放里就带 done），那就不要再发头。
    if (!settled) response.flushHeaders()
  })
  unsubscribe()
}

/**
 * 提交一次执行并立刻订阅它的 SSE。
 *
 * 保留既有入口与签名（前四个参数不变）：会话标识响应头由调用方设置，
 * 执行标识在这里回传，供客户端在断线后按标识重新订阅。
 * 同一请求标识重复提交会复用同一执行，不会产生第二次副作用。
 */
export const streamSession = async (
  session: StreamableSession,
  sessionId: string,
  prompt: string,
  response: SseResponse,
  options?: { requestId?: string | null; persistence?: ExecutionPersistence }
): Promise<void> => {
  const started = startExecution({
    session,
    sessionId,
    prompt,
    requestId: options?.requestId ?? null,
    ...(options?.persistence ? { persistence: options.persistence } : {}),
  })
  // 必须在写 SSE 头之前给出：客户端据此在断线后重新订阅同一执行。
  response.setHeader("x-ai-assistant-execution-id", started.execution.id)
  await streamExecutionEvents(started.execution.id, response)
}
