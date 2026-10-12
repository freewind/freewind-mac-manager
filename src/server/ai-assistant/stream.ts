import type {
  AgentSession,
  AgentSessionEvent,
} from "@earendil-works/pi-coding-agent"
import { finishSessionRun, startSessionRun } from "./store"

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

/** 历史保存失败时给用户看的说明；具体错误只进脱敏日志。 */
const HISTORY_FAILED_DONE = "回答已完成，但会话历史保存失败"
const HISTORY_FAILED_UNKNOWN = "结果未知，且会话历史保存失败"

/**
 * 把一次助手指令的执行过程桥接成 SSE。
 *
 * 事件：`delta`（text / thinking 增量）、`tool`（工具调用起止）、
 * `message_end`（单条消息收尾）、`error`、`done`（终态）。
 *
 * 状态迁移：进入前写 running 并记录用户输入 → 正常结束 done /
 * 出错或连接中断 unknown。中断按“结果未知”处理：中止上游请求，不重发、
 * 不宣告成功；已经拿到的部分回答一并落到历史里。
 */
export const streamSession = async (
  session: StreamableSession,
  sessionId: string,
  prompt: string,
  response: SseResponse
): Promise<void> => {
  // 先落用户输入与 running：写不进去就不要开始跑（例如历史已被清空），
  // 这时还没写 SSE 头，调用方仍能回一条普通 JSON 错误。
  startSessionRun(sessionId, { role: "user", text: prompt })

  response.setHeader("Content-Type", "text/event-stream")
  response.setHeader("Cache-Control", "no-cache")
  response.setHeader("Connection", "keep-alive")
  response.flushHeaders()

  const send = (event: string, data: unknown): void => {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  /** 已经拿到的部分回答；会话被回收时取不到就是 null。 */
  const partialAnswer = (): string | null => {
    try {
      return session.getLastAssistantText() ?? null
    } catch {
      return null
    }
  }

  /**
   * 写终态。历史写不进去不能假装一切正常：记一条脱敏日志，
   * 并把「历史保存失败」明确告诉用户（不记录任何提示词内容）。
   */
  const recordFinish = (
    status: "done" | "unknown",
    answer: string | null
  ): string | null => {
    try {
      finishSessionRun(sessionId, status, answer)
      return null
    } catch (error) {
      console.error(
        `[mac-manager] AI 助手历史保存失败（会话 ${sessionId}，终态 ${status}）：${
          error instanceof Error ? error.message : "未知错误"
        }`
      )
      return status === "done" ? HISTORY_FAILED_DONE : HISTORY_FAILED_UNKNOWN
    }
  }

  let disconnected = false
  let finished = false
  const onClose = (): void => {
    if (finished || disconnected) return
    disconnected = true
    session.abort()
  }
  response.on("close", onClose)

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "message_update") {
      const update = event.assistantMessageEvent
      if (update.type === "text_delta") {
        send("delta", { type: "text", delta: update.delta })
      } else if (update.type === "thinking_delta") {
        send("delta", { type: "thinking", delta: update.delta })
      }
      return
    }
    if (event.type === "tool_execution_start") {
      send("tool", {
        id: event.toolCallId,
        name: event.toolName,
        status: "running",
        input: event.args,
      })
      return
    }
    if (event.type === "tool_execution_end") {
      send("tool", {
        id: event.toolCallId,
        name: event.toolName,
        status: event.isError ? "error" : "done",
        output: event.result,
      })
      return
    }
    if (event.type === "message_end") {
      send("message_end", { role: event.message.role })
    }
  })

  try {
    await session.prompt(prompt)
    const answer = partialAnswer()
    if (disconnected) {
      const note = recordFinish("unknown", answer)
      send("done", {
        status: "unknown",
        sessionId,
        message: note ?? "连接中断，结果未知",
      })
      return
    }
    const note = recordFinish("done", answer)
    send("done", {
      status: "done",
      sessionId,
      ...(note ? { message: note } : {}),
    })
  } catch (error) {
    send("error", {
      message:
        error instanceof Error ? error.message : "助手执行失败，请重新读取确认",
    })
    const note = recordFinish("unknown", partialAnswer())
    send("done", {
      status: "unknown",
      sessionId,
      message: note ?? "执行未完成，结果未知",
    })
  } finally {
    finished = true
    unsubscribe()
    response.end()
  }
}
