import { ApiPath } from "@shared/api-path"
import { buildAuthorizationHeader } from "@shared/client-api"
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

export type SseEvent = { event: string; data: string }

let idSeed = 0
const newId = (): string => {
  idSeed += 1
  return `ai-${Date.now().toString(36)}-${idSeed}`
}

/**
 * 按 SSE 的空行分帧。返回已完整的帧与尚未结束的尾巴，
 * 尾巴要留在缓冲区，等下一个 chunk 到齐再解析。
 */
export const parseSseFrames = (
  buffer: string
): { events: SseEvent[]; rest: string } => {
  const chunks = buffer.replace(/\r\n/g, "\n").split("\n\n")
  const rest = chunks.pop() ?? ""
  const events = chunks.map((chunk) => {
    let event = "message"
    const dataLines: string[] = []
    for (const line of chunk.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim()
      else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""))
      }
    }
    return { event, data: dataLines.join("\n") }
  })
  return { events, rest }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {}

const parseJson = (text: string): Record<string, unknown> => {
  try {
    return asRecord(JSON.parse(text))
  } catch {
    return {}
  }
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
}

const EMPTY_STATE: ChatState = { messages: [], status: "ready", error: null }

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
    if (index === -1) return [...parts, { type: "tool", ...tool }]
    const next = [...parts]
    next[index] = { type: "tool", ...tool }
    return next
  })

/** 收尾时把仍在流的思考块定格，避免卡片一直闪。 */
const settleParts = (state: ChatState): ChatState =>
  updateAssistantParts(state, (parts) =>
    parts.map((part) =>
      part.type === "thinking" ? { ...part, done: true } : part
    )
  )

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body: unknown = await response.json()
    const message = asRecord(body).message
    if (typeof message === "string" && message) return message
  } catch {
    // 非 JSON 响应按状态码说明。
  }
  return `请求失败（HTTP ${response.status}）`
}

const readStream = async (
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => void
): Promise<void> => {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const { events, rest } = parseSseFrames(buffer)
    buffer = rest
    for (const event of events) onEvent(event)
  }
  for (const event of parseSseFrames(`${buffer}\n\n`).events) onEvent(event)
}

/**
 * 自己读 SSE 流：EventSource 不支持 POST 与自定义头，所以用 fetch + 手动分帧。
 * 不用轮询、不在 effect 里发请求；中断与结果未知都不自动重试。
 */
export const useStreamChat = (options: {
  sessionId: string | null
  onSessionId: (sessionId: string) => void
}) => {
  const [state, setState] = useState<ChatState>(EMPTY_STATE)
  const controllerRef = useRef<AbortController | null>(null)
  const sessionIdRef = useRef<string | null>(options.sessionId)
  const onSessionIdRef = useRef(options.onSessionId)
  onSessionIdRef.current = options.onSessionId

  const persistSessionId = useCallback((sessionId: string) => {
    sessionIdRef.current = sessionId
    onSessionIdRef.current(sessionId)
  }, [])

  const stop = useCallback(() => {
    controllerRef.current?.abort()
  }, [])

  const send = useCallback(
    async (payload: { role: "user"; content: string }) => {
      const text = payload.content.trim()
      if (!text || controllerRef.current) return
      setState((prev) => ({
        messages: [
          ...prev.messages,
          { id: newId(), role: "user", parts: [{ type: "text", text }] },
          { id: newId(), role: "assistant", parts: [] },
        ],
        status: "submitted",
        error: null,
      }))
      const controller = new AbortController()
      controllerRef.current = controller
      let sawDone = false
      try {
        const response = await fetch(ApiPath.aiAssistantMessage, {
          method: "POST",
          headers: {
            ...buildAuthorizationHeader(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...(sessionIdRef.current
              ? { sessionId: sessionIdRef.current }
              : {}),
            prompt: text,
          }),
          signal: controller.signal,
        })
        const returnedId = response.headers.get("x-ai-assistant-session-id")
        if (returnedId) persistSessionId(returnedId)
        if (!response.ok || !response.body) {
          const message = await readErrorMessage(response)
          setState((prev) => ({
            ...prev,
            status: "error",
            error: new Error(message),
          }))
          return
        }
        setState((prev) => ({ ...prev, status: "streaming" }))
        await readStream(response.body, (event) => {
          const data = parseJson(event.data)
          if (event.event === "delta") {
            const delta = data.delta
            if (typeof delta === "string" && delta) {
              setState((prev) =>
                appendDelta(
                  prev,
                  data.type === "thinking" ? "thinking" : "text",
                  delta
                )
              )
            }
            return
          }
          if (event.event === "tool") {
            const toolCallId = data.id
            const name = data.name
            if (typeof toolCallId !== "string" || typeof name !== "string")
              return
            const status =
              data.status === "done"
                ? ("done" as const)
                : data.status === "error"
                  ? ("error" as const)
                  : ("running" as const)
            setState((prev) =>
              upsertTool(prev, {
                toolCallId,
                name,
                status,
                input: data.input,
                output: data.output,
              })
            )
            return
          }
          if (event.event === "error") {
            const message = data.message
            setState((prev) => ({
              ...prev,
              error: new Error(
                typeof message === "string" ? message : "助手执行失败"
              ),
            }))
            return
          }
          if (event.event === "done") {
            sawDone = true
            const sessionId = data.sessionId
            if (typeof sessionId === "string" && sessionId) {
              persistSessionId(sessionId)
            }
            if (data.status === "unknown") {
              const message = data.message
              setState((prev) => ({
                ...settleParts(prev),
                status: "error",
                error: new Error(
                  typeof message === "string"
                    ? message
                    : "结果未知，请重新读取核实"
                ),
              }))
              return
            }
            setState((prev) => ({ ...settleParts(prev), status: "ready" }))
          }
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
              : "网络请求失败，结果未知，请重新读取核实"
          ),
        }))
      } finally {
        controllerRef.current = null
      }
    },
    [persistSessionId]
  )

  return {
    messages: toUiMessages(state.messages),
    status: state.status,
    error: state.error ?? undefined,
    sessionId: sessionIdRef.current,
    send,
    stop,
  }
}
