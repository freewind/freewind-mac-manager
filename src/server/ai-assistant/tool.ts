import { Type } from "@earendil-works/pi-ai"
import { defineTool } from "@earendil-works/pi-coding-agent"
import { getAuthPassword, resolveServerPort } from "@server/env"

export const AI_ASSISTANT_TOOL_NAME = "call_mac_manager_api"

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const
type ApiMethod = (typeof METHODS)[number]

const MAX_BODY_BYTES = 256 * 1024
const MAX_RESPONSE_BYTES = 64 * 1024
const REQUEST_TIMEOUT_MS = 60_000

/** 助手不能通过本工具碰自己的会话端点（会递归），也不能改访问密码。 */
const FORBIDDEN_PREFIXES = ["/api/ai-assistant/", "/api/auth/"] as const

export type ApiRequestInput = {
  method: string
  path: string
  body?: unknown
}

/**
 * 校验助手要发起的本应用 API 调用。返回错误说明，合法时返回 null。
 *
 * 只允许访问本机回环上的本应用 API：外部地址在构造 URL 时就不可能命中，
 * 但路径本身仍要卡住递归调用与凭据类端点。
 */
export const validateApiRequest = (input: ApiRequestInput): string | null => {
  if (typeof input.method !== "string")
    return `不支持的 method：${String(input.method)}（只允许 ${METHODS.join("/")}）`
  const method = input.method.toUpperCase()
  if (!METHODS.includes(method as ApiMethod))
    return `不支持的 method：${input.method}（只允许 ${METHODS.join("/")}）`
  const target = input.path
  if (typeof target !== "string" || !target.startsWith("/api/"))
    return "path 必须以 /api/ 开头"
  for (const prefix of FORBIDDEN_PREFIXES) {
    if (target.startsWith(prefix)) return `禁止调用 ${prefix} 下的端点`
  }
  if (input.body !== undefined && input.body !== null) {
    const size = Buffer.byteLength(JSON.stringify(input.body) ?? "", "utf8")
    if (size > MAX_BODY_BYTES) return "请求体超过 256KB 限制"
  }
  return null
}

const truncate = (text: string): string =>
  text.length > MAX_RESPONSE_BYTES
    ? `${text.slice(0, MAX_RESPONSE_BYTES)}…（已截断）`
    : text

const parseBody = (text: string): unknown => {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * 让助手直接调用本应用 API：复用应用自身的鉴权、校验、任务运行时与危险动作确认，
 * 比让模型自己拼 shell 命令可靠得多。
 */
export const callMacManagerApi = defineTool({
  name: AI_ASSISTANT_TOOL_NAME,
  label: "调用本应用 API",
  description:
    "通过 freewind-mac-manager 自己的 HTTP API（127.0.0.1，本机回环）调用应用能力，覆盖全部只读与写操作端点，例如流量、磁盘、进程、端口、文件、系统服务、Docker、Caddy、FRP。这是操作本应用功能的首选方式：入参会按应用契约校验，写操作走任务运行时并带危险动作确认。path 必须是本应用的真实接口路径，如 /api/docker/containers；不要调用 /api/ai-assistant/* 或 /api/auth/*。",
  promptGuidelines: [
    "操作本应用功能时优先用 call_mac_manager_api；应用 API 无法满足时才用 read/bash/write/edit/grep/ls。",
  ],
  parameters: Type.Object({
    method: Type.Union([
      Type.Literal("GET"),
      Type.Literal("POST"),
      Type.Literal("PUT"),
      Type.Literal("PATCH"),
      Type.Literal("DELETE"),
    ]),
    path: Type.String(),
    body: Type.Optional(Type.Unknown()),
  }),
  execute: async (_toolCallId, params, signal) => {
    const invalid = validateApiRequest(params)
    if (invalid) {
      return {
        content: [{ type: "text" as const, text: `调用被拒绝：${invalid}` }],
        details: {},
        isError: true,
      }
    }
    const method = params.method.toUpperCase()
    const url = `http://127.0.0.1:${resolveServerPort()}${params.path}`
    const password = getAuthPassword()
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (password) headers.Authorization = `Bearer ${password}`
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    try {
      const response = await fetch(url, {
        method,
        headers,
        body:
          method === "GET" || params.body === undefined || params.body === null
            ? undefined
            : JSON.stringify(params.body),
        signal: combined,
      })
      const text = truncate(await response.text())
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: response.status,
              body: parseBody(text),
            }),
          },
        ],
        details: {},
      }
    } catch (error) {
      const reason =
        timeout.aborted ||
        (error instanceof Error && error.name === "TimeoutError")
          ? "调用超时（60 秒），结果未知"
          : signal?.aborted
            ? "调用被中止"
            : "网络请求失败"
      return {
        content: [
          {
            type: "text" as const,
            text: `${reason}：${method} ${params.path}`,
          },
        ],
        details: {},
        isError: true,
      }
    }
  },
})
