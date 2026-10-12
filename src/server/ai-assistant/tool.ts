import { createHash } from "node:crypto"
import { Type } from "@earendil-works/pi-ai"
import { defineTool } from "@earendil-works/pi-coding-agent"
import { getAuthPassword, resolveServerPort } from "@server/env"
import { TASK_REQUEST_ID_HEADER } from "@shared/api-contract/schemas/common"

export const AI_ASSISTANT_TOOL_NAME = "call_mac_manager_api"

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const
type ApiMethod = (typeof METHODS)[number]
/** 会改状态的方法：这类调用才需要任务请求标识与「结果未知」措辞。 */
const WRITE_METHODS: readonly ApiMethod[] = ["POST", "PUT", "PATCH", "DELETE"]

const MAX_BODY_BYTES = 256 * 1024
const MAX_RESPONSE_BYTES = 64 * 1024
const REQUEST_TIMEOUT_MS = 60_000

/** 助手不能通过本工具碰自己的会话端点（会递归），也不能改访问密码。 */
const FORBIDDEN_PREFIXES = ["/api/ai-assistant/", "/api/auth/"] as const
const ALLOWED_HOST = "127.0.0.1"

export type ApiRequestInput = {
  method: string
  path: string
  body?: unknown
}

export type ResolvedApiRequest = {
  method: ApiMethod
  /** 规范化之后的完整请求地址（带查询串）。 */
  url: string
  /** 规范化之后的路径（带查询串）。 */
  path: string
  write: boolean
}

export type ApiRequestDecision =
  | { ok: true; request: ResolvedApiRequest }
  | { ok: false; reason: string }

/**
 * 校验并规范化助手要发起的本应用 API 调用。
 *
 * 先按 URL 规则解析（把 `%2e%2e`、`.`、重复斜杠都归一化）再检查，
 * 避免用编码或 `..` 绕过对 /api/ai-assistant/ 与 /api/auth/ 的限制；
 * 主机必须是本机回环的当前端口，别的地址一律不发。
 */
export const resolveApiRequest = (
  input: ApiRequestInput,
  port: number
): ApiRequestDecision => {
  if (typeof input.method !== "string") {
    return { ok: false, reason: `不支持的 method：${String(input.method)}` }
  }
  const method = input.method.toUpperCase()
  if (!METHODS.includes(method as ApiMethod)) {
    return {
      ok: false,
      reason: `不支持的 method：${input.method}（只允许 ${METHODS.join("/")}）`,
    }
  }
  if (typeof input.path !== "string" || !input.path) {
    return { ok: false, reason: "path 必须是非空字符串" }
  }
  let url: URL
  try {
    url = new URL(input.path, `http://${ALLOWED_HOST}:${port}`)
  } catch {
    return { ok: false, reason: "path 不是合法的接口路径" }
  }
  if (url.host !== `${ALLOWED_HOST}:${port}`) {
    return {
      ok: false,
      reason: `只允许访问本应用（${ALLOWED_HOST}:${port}），拒绝 ${url.host}`,
    }
  }
  const normalized = `${url.pathname}${url.search}`
  if (!url.pathname.startsWith("/api/")) {
    return { ok: false, reason: "path 必须以 /api/ 开头" }
  }
  for (const prefix of FORBIDDEN_PREFIXES) {
    if (url.pathname.startsWith(prefix)) {
      return { ok: false, reason: `禁止调用 ${prefix} 下的端点` }
    }
  }
  if (input.body !== undefined && input.body !== null) {
    const size = Buffer.byteLength(JSON.stringify(input.body) ?? "", "utf8")
    if (size > MAX_BODY_BYTES)
      return { ok: false, reason: "请求体超过 256KB 限制" }
  }
  return {
    ok: true,
    request: {
      method: method as ApiMethod,
      url: url.toString(),
      path: normalized,
      write: WRITE_METHODS.includes(method as ApiMethod),
    },
  }
}

/**
 * 由 toolCallId 派生稳定的任务请求标识：同一次工具调用重复执行都用同一个 id，
 * 服务端据此复用任务记录，不会把重试变成第二次执行。
 */
export const requestIdForToolCall = (toolCallId: string): string =>
  `req_${createHash("sha256").update(toolCallId).digest("hex").slice(0, 32)}`

/** 读响应体：读满上限就停下并取消剩余数据，不再无界读进内存。 */
const readBoundedBody = async (
  body: ReadableStream<Uint8Array>,
  limit: number
): Promise<{ text: string; truncated: boolean }> => {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ""
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      if (text.length >= limit) {
        truncated = true
        await reader.cancel()
        break
      }
    }
    if (!truncated) text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  return { text: truncated ? text.slice(0, limit) : text, truncated }
}

const parseBody = (text: string): unknown => {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * 让助手直接调用本应用 API，而不是自己拼 shell 命令。
 *
 * 说明口径：这里只负责「把请求发出去、把状态与响应体带回来」，
 * 不会替用户确认危险动作——那一步必须由模型先讲清目标与影响、拿到明确同意。
 */
export const callMacManagerApi = defineTool({
  name: AI_ASSISTANT_TOOL_NAME,
  label: "调用本应用 API",
  description:
    "通过 freewind-mac-manager 自己的 HTTP API（只允许 127.0.0.1 当前端口）调用应用能力，覆盖只读与写操作端点，例如流量、磁盘、进程、端口、文件、系统服务、Docker、Caddy、FRP、任务。这是操作本应用功能的首选方式：入参由助手侧与应用侧各校验一次。写操作会带上任务请求标识并走任务运行时，返回 202 只表示任务已被接收，完成与否必须再用 GET /api/tasks 查任务状态核实，不能当成已完成；4xx/5xx 一律是失败。这个接口不会替你确认危险动作：杀进程、删文件、重启服务、覆盖配置前，必须先把目标和影响告诉用户并拿到明确同意。path 必须是本应用的真实接口路径，如 /api/docker/containers；不要调用 /api/ai-assistant/* 或 /api/auth/*。",
  promptGuidelines: [
    "操作本应用功能时优先用 call_mac_manager_api；应用 API 无法满足时才用 read/bash/write/edit/grep/ls。",
    "写操作返回 202 只代表任务已接收：必须用 GET /api/tasks 核实结果，不能当作完成。危险动作先说明目标与影响并得到用户明确确认。",
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
  execute: async (toolCallId, params, signal) => {
    const decision = resolveApiRequest(params, resolveServerPort())
    if (!decision.ok) {
      return {
        content: [
          { type: "text" as const, text: `调用被拒绝：${decision.reason}` },
        ],
        details: {},
        isError: true,
      }
    }
    const { method, url, path: requestPath, write } = decision.request
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    const password = getAuthPassword()
    if (password) headers.Authorization = `Bearer ${password}`
    // 写操作带上任务请求标识：服务端据此复用任务，重试不会变成第二次执行。
    if (write)
      headers[TASK_REQUEST_ID_HEADER] = requestIdForToolCall(toolCallId)
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
        // 不跟重定向：本应用接口不会跳转，跟随只会把请求带出允许范围。
        redirect: "error",
      })
      const read = response.body
        ? await readBoundedBody(response.body, MAX_RESPONSE_BYTES)
        : { text: "", truncated: false }
      const failed = response.status >= 400
      // 只回状态与响应体：绝不把请求头（访问密码）带进模型上下文。
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: response.status,
              body: parseBody(read.text),
              ...(read.truncated
                ? { truncated: true, note: "响应超过 64KB，已截断" }
                : {}),
              ...(response.status === 202
                ? {
                    note: "任务已接收（202），完成与否要用 GET /api/tasks 核实",
                  }
                : {}),
            }),
          },
        ],
        details: {},
        isError: failed,
      }
    } catch (error) {
      const timedOut =
        timeout.aborted ||
        (error instanceof Error && error.name === "TimeoutError")
      const interrupted = Boolean(signal?.aborted)
      // 写操作中断时结果未知；只读接口中断只是读取失败，没有副作用。
      const reason = write
        ? timedOut
          ? "写操作调用超时（60 秒），结果未知，请重新读取目标核实"
          : interrupted
            ? "写操作调用被中止，结果未知，请重新读取目标核实"
            : "写操作网络中断，结果未知，请重新读取目标核实"
        : timedOut
          ? "只读调用超时（60 秒），未产生副作用"
          : "只读调用失败，未产生副作用"
      return {
        content: [
          {
            type: "text" as const,
            text: `${reason}：${method} ${requestPath}`,
          },
        ],
        details: {},
        isError: true,
      }
    }
  },
})
