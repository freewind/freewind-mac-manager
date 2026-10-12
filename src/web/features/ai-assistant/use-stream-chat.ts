import {
  type AiAssistantStreamEvent,
  ApiRequestError,
  stopAiAssistantExecution,
  streamAiAssistantMessage,
} from "@shared/client-api"
import type { ChatStatus, UIMessage } from "ai"
import { useCallback, useRef, useState } from "react"

/** 自定义工具在 Agent Elements 里走「用户工具」通道，才能命中 toolRenderers。 */
export const AI_ASSISTANT_TOOL_NAME = "call_mac_manager_api"
const USER_TOOL_PART_PREFIX = "tool-mcp__user-tools__"

/** 内置工具映射到官方专用卡片；未收录的走通用卡片回退。 */
const BUILTIN_PART_TYPES: Record<string, string> = {
  read: "tool-Read",
  bash: "tool-Bash",
  write: "tool-Write",
  edit: "tool-Edit",
  grep: "tool-Grep",
  ls: "tool-Ls",
}

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string; done: boolean }
  | {
      type: "tool"
      toolCallId: string
      name: string
      status: "running" | "done" | "error"
      input: unknown
      output: unknown
    }

export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  parts: ChatPart[]
}

let idSeed = 0
const newId = (): string => {
  idSeed += 1
  return `ai-${Date.now().toString(36)}-${idSeed}`
}

const toUiPart = (
  part: ChatPart,
  messageId: string
): Record<string, unknown> => {
  if (part.type === "text") return { type: "text", text: part.text }
  if (part.type === "thinking") {
    return {
      type: "tool-Thinking",
      toolCallId: `${messageId}-thinking`,
      // 官方 Thinking 卡片从 input.thought 读正文；state 决定它是否继续闪。
      state: part.done ? "output-available" : "input-available",
      input: { thought: part.text },
    }
  }
  const partType =
    part.name === AI_ASSISTANT_TOOL_NAME
      ? `${USER_TOOL_PART_PREFIX}${part.name}`
      : (BUILTIN_PART_TYPES[part.name] ?? `tool-${part.name}`)
  return {
    type: partType,
    toolCallId: part.toolCallId,
    state:
      part.status === "running"
        ? "input-available"
        : part.status === "error"
          ? "output-error"
          : "output-available",
    input: part.input,
    output: part.output,
  }
}

/** AgentChat 只认 Vercel AI SDK 的 UIMessage：这里做一次形状转换。 */
export const toUiMessages = (messages: ChatMessage[]): UIMessage[] =>
  messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts.map((part) => toUiPart(part, message.id)),
  })) as unknown as UIMessage[]

type ChatState = {
  messages: ChatMessage[]
  status: ChatStatus
  error: Error | null
  /** 失败时的 HTTP 状态码（如 404 表示会话已过期），没有则为 null。 */
  errorStatus: number | null
}

const EMPTY_STATE: ChatState = {
  messages: [],
  status: "ready",
  error: null,
  errorStatus: null,
}

const updateAssistantParts = (
  state: ChatState,
  update: (parts: ChatPart[]) => ChatPart[]
): ChatState => {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index]
    if (message.role !== "assistant") continue
    const messages = [...state.messages]
    messages[index] = { ...message, parts: update(message.parts) }
    return { ...state, messages }
  }
  return state
}

const appendDelta = (
  state: ChatState,
  kind: "text" | "thinking",
  delta: string
): ChatState =>
  updateAssistantParts(state, (parts) => {
    const last = parts[parts.length - 1]
    if (last && last.type === kind) {
      return kind === "thinking" && last.type === "thinking"
        ? [
            ...parts.slice(0, -1),
            { ...last, text: last.text + delta, done: false },
          ]
        : [...parts.slice(0, -1), { ...last, text: last.text + delta }]
    }
    return [
      ...parts,
      kind === "thinking"
        ? { type: "thinking", text: delta, done: false }
        : { type: "text", text: delta },
    ]
  })

/**
 * 工具事件合并。开始事件带 input，结束事件通常只带 output：
 * 只覆盖确实带值的字段，否则结束时会把手头已有的 input 抹成 undefined。
 */
const upsertTool = (
  state: ChatState,
  tool: {
    toolCallId: string
    name: string
    status: "running" | "done" | "error"
    input: unknown
    output: unknown
  }
): ChatState =>
  updateAssistantParts(state, (parts) => {
    const index = parts.findIndex(
      (part) => part.type === "tool" && part.toolCallId === tool.toolCallId
    )
    const previous = index === -1 ? null : parts[index]
    const previousTool = previous?.type === "tool" ? previous : null
    const merged: ChatPart = {
      type: "tool",
      toolCallId: tool.toolCallId,
      name: tool.name || previousTool?.name || "",
      status: tool.status,
      input: tool.input !== undefined ? tool.input : previousTool?.input,
      output: tool.output !== undefined ? tool.output : previousTool?.output,
    }
    if (index === -1) return [...parts, merged]
    const next = [...parts]
    next[index] = merged
    return next
  })

/** 收尾时把仍在流的思考块定格，避免卡片一直闪。 */
const settleParts = (state: ChatState): ChatState =>
  updateAssistantParts(state, (parts) =>
    parts.map((part) =>
      part.type === "thinking" ? { ...part, done: true } : part
    )
  )

/**
 * 助手对话的本地状态：消息装配、终态判定与会话标识。
 *
 * 传输（地址、鉴权、fetch、SSE 分帧、401 派发、离线拦截）都在
 * shared/client-api 的 streamAiAssistantMessage 里，这里只处理业务消息；
 * 不在 effect 里发请求，断连与结果未知都不自动重试。
 */
export const useStreamChat = (options: {
  sessionId: string | null
  /** 会话标识变化（含新建对话时的 null）都要同步出去。 */
  onSessionId: (sessionId: string | null) => void
}) => {
  const [state, setState] = useState<ChatState>(EMPTY_STATE)
  const controllerRef = useRef<AbortController | null>(null)
  /** 服务端执行标识：停止与断线后重新订阅都靠它，不靠 HTTP 连接。 */
  const executionIdRef = useRef<string | null>(null)
  const sessionIdRef = useRef<string | null>(options.sessionId)
  const onSessionIdRef = useRef(options.onSessionId)
  onSessionIdRef.current = options.onSessionId

  const persistSessionId = useCallback((sessionId: string | null) => {
    sessionIdRef.current = sessionId
    onSessionIdRef.current(sessionId)
  }, [])

  /**
   * 停止：断线只解除订阅，停止必须显式告诉服务端。
   * 先解除本地订阅，再请求服务端取消这次执行。
   */
  const stop = useCallback(() => {
    const executionId = executionIdRef.current
    controllerRef.current?.abort()
    if (!executionId) return
    void stopAiAssistantExecution(executionId).catch(() => {
      // 停止请求失败不改变本地已中止的事实；结果以重新读取为准。
    })
  }, [])

  /**
   * 新建对话：清空本地消息与会话标识。
   * 只在空闲时允许：进行中清空会让正在跑的答复找不到归宿。
   */
  const reset = useCallback((): boolean => {
    if (controllerRef.current) return false
    executionIdRef.current = null
    persistSessionId(null)
    setState(EMPTY_STATE)
    return true
  }, [persistSessionId])

  const handleEvent = useCallback(
    (event: AiAssistantStreamEvent) => {
      if (event.type === "delta") {
        setState((prev) => {
          const started =
            prev.status === "submitted"
              ? { ...prev, status: "streaming" as ChatStatus }
              : prev
          return appendDelta(started, event.kind, event.delta)
        })
        return
      }
      if (event.type === "tool") {
        setState((prev) =>
          upsertTool(prev, {
            toolCallId: event.toolCallId,
            name: event.name,
            status: event.status,
            input: event.input,
            output: event.output,
          })
        )
        return
      }
      if (event.type === "error") {
        setState((prev) => ({ ...prev, error: new Error(event.message) }))
        return
      }
      if (event.sessionId) persistSessionId(event.sessionId)
      if (event.status === "unknown") {
        setState((prev) => ({
          ...settleParts(prev),
          status: "error",
          error: new Error(event.message ?? "结果未知，请重新读取核实"),
        }))
        return
      }
      // 服务端明确告知的问题（例如历史保存失败）要展示出来，不默默成功。
      const note = event.message
      setState((prev) =>
        note
          ? appendDelta(settleParts(prev), "text", `\n\n（${note}）`)
          : { ...settleParts(prev), status: "ready" }
      )
    },
    [persistSessionId]
  )

  const send = useCallback(
    async (payload: { role: "user"; content: string }) => {
      const text = payload.content.trim()
      // 上一条还在流里时忽略新指令：不排队、不重发。
      if (!text || controllerRef.current) return
      setState((prev) => ({
        messages: [
          ...prev.messages,
          { id: newId(), role: "user", parts: [{ type: "text", text }] },
          { id: newId(), role: "assistant", parts: [] },
        ],
        status: "submitted",
        error: null,
        errorStatus: null,
      }))
      const controller = new AbortController()
      controllerRef.current = controller
      executionIdRef.current = null
      let sawDone = false
      const onEvent = (event: AiAssistantStreamEvent): void => {
        if (event.type === "done") sawDone = true
        handleEvent(event)
      }
      try {
        await streamAiAssistantMessage({
          sessionId: sessionIdRef.current,
          prompt: text,
          signal: controller.signal,
          onSessionId: persistSessionId,
          onExecutionId: (executionId) => {
            executionIdRef.current = executionId
          },
          onEvent,
        })
        if (!sawDone) {
          setState((prev) => ({
            ...settleParts(prev),
            status: "error",
            error: new Error("连接中断，结果未知，请重新读取核实"),
          }))
        }
      } catch (error) {
        const aborted =
          controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError")
        setState((prev) => ({
          ...settleParts(prev),
          status: "error",
          error: new Error(
            aborted
              ? "已中止，结果未知，请重新读取核实"
              : error instanceof Error && error.message
                ? error.message
                : "网络请求失败，结果未知，请重新读取核实"
          ),
          errorStatus:
            error instanceof ApiRequestError ? error.status : prev.errorStatus,
        }))
      } finally {
        controllerRef.current = null
      }
    },
    [handleEvent, persistSessionId]
  )

  return {
    messages: toUiMessages(state.messages),
    status: state.status,
    error: state.error ?? undefined,
    /** 会话不存在/已过期（404）时界面要引导新建对话。 */
    errorStatus: state.errorStatus,
    sessionId: sessionIdRef.current,
    send,
    stop,
    reset,
  }
}
