import type {
  AgentSession,
  AgentSessionEvent,
} from "@earendil-works/pi-coding-agent"
import type { AiAssistantSessionStatus } from "./store"
import { appendMessage, readSession, saveSession } from "./store"

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

const updateStatus = (
  sessionId: string,
  status: AiAssistantSessionStatus
): void => {
  const snapshot = readSession(sessionId)
  saveSession({
    id: sessionId,
    settingsSnapshot: snapshot.settingsSnapshot,
    messages: snapshot.messages,
    status,
    createdAt: snapshot.createdAt,
    updatedAt: Date.now(),
  })
}

/**
 * 把一次助手指令的执行过程桥接成 SSE。
 *
 * 事件：`delta`（text / thinking 增量）、`tool`（工具调用起止）、
 * `message_end`（单条消息收尾）、`error`、`done`（终态）。
 *
 * 连接中断按“结果未知”处理：中止上游请求，不重发、不宣告成功。
 */
export const streamSession = async (
  session: StreamableSession,
  sessionId: string,
  prompt: string,
  response: SseResponse
): Promise<void> => {
  response.setHeader("Content-Type", "text/event-stream")
  response.setHeader("Cache-Control", "no-cache")
  response.setHeader("Connection", "keep-alive")
  response.flushHeaders()

  const send = (event: string, data: unknown): void => {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
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
    if (disconnected) {
      send("done", {
        status: "unknown",
        sessionId,
        message: "连接中断，结果未知",
      })
      return
    }
    const answer = session.getLastAssistantText()
    try {
      appendMessage(sessionId, { role: "user", text: prompt })
      if (answer) appendMessage(sessionId, { role: "assistant", text: answer })
      updateStatus(sessionId, "done")
    } catch {
      // 会话记录可能已被清理：SSE 正常收尾，不因此把这次回答标成失败。
    }
    send("done", { status: "done", sessionId })
  } catch (error) {
    send("error", {
      message:
        error instanceof Error ? error.message : "助手执行失败，请重新读取确认",
    })
    try {
      updateStatus(sessionId, "unknown")
    } catch {
      // 同上：记录不可写不影响终态事件。
    }
    send("done", {
      status: "unknown",
      sessionId,
      message: "执行未完成，结果未知",
    })
  } finally {
    finished = true
    unsubscribe()
    response.end()
  }
}
