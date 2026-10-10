import { contract, TASK_REQUEST_ID_HEADER } from "@shared/api-contract"
import { initClient } from "@ts-rest/core"

/**
 * 客户端等待的上限：超过就不再等这一次响应。
 * 它只解除等待，不等于服务端停止工作，也不触发重发——结果未知时必须去核实。
 */
const NETWORK_WAIT_MS = 60_000

const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"]

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly responseBody?: unknown,
    cause?: unknown,
    /** 写操作在结果无法确认时为 true：不能提示成功，也不能自动重试。 */
    readonly resultUnknown = false,
    /** 已登记的请求标识：即使这次响应丢失，也能据此查回任务。 */
    readonly requestId: string | null = null
  ) {
    super(message, { cause })
    this.name = "ApiRequestError"
  }
}

const errorMessage = (body: unknown): string | null => {
  if (typeof body === "string" && body.trim()) return body.trim()
  if (body && typeof body === "object" && "message" in body) {
    const message = body.message
    return typeof message === "string" && message.trim() ? message : null
  }
  return null
}

export const unwrap = <T>(result: { status: number; body: unknown }): T => {
  if (result.status >= 200 && result.status < 300) return result.body as T
  const detail = errorMessage(result.body)
  throw new ApiRequestError(
    detail
      ? `请求失败（HTTP ${result.status}）：${detail}`
      : `请求失败（HTTP ${result.status}）`,
    result.status,
    result.body
  )
}

/**
 * 生成一次写操作的请求标识。服务端据此复用任务记录：网络重试不会变成第二次执行，
 * 响应丢失也能按这个标识查回任务。
 */
export const newRequestId = (): string => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
  return `req_${hex}`
}

/** 写操作的请求标识头；键取自契约里的常量，保证与服务端校验一致。 */
export const taskRequestHeaders = (
  requestId: string
): { [TASK_REQUEST_ID_HEADER]: string } => ({
  [TASK_REQUEST_ID_HEADER]: requestId,
})

/** 请求是写操作：结果未知时的措辞与重试策略都不同。 */
export const isWriteMethod = (method: string): boolean =>
  WRITE_METHODS.includes(method.toUpperCase())

/** 前端统一走相对路径，并在写请求中附带任务请求标识。 */
export const apiClient = initClient(contract, {
  baseUrl: "",
  api: async ({ path, method, headers, body, signal }) => {
    const requestHeaders = new Headers(headers)
    const write = isWriteMethod(method)
    const requestId = requestHeaders.get(TASK_REQUEST_ID_HEADER)

    const timeoutSignal = AbortSignal.timeout(NETWORK_WAIT_MS)
    const combined = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal

    let response: Response
    try {
      response = await fetch(path, {
        method,
        headers: requestHeaders,
        body: body as BodyInit | undefined,
        credentials: "same-origin",
        signal: combined,
      })
    } catch (error) {
      const exceeded =
        timeoutSignal.aborted ||
        (error instanceof Error && error.name === "TimeoutError")
      const message = exceeded
        ? write
          ? "等待响应超时，结果未知，请重新读取确认"
          : "请求超时"
        : write
          ? "请求结果未知，请重新读取确认"
          : "网络请求失败"
      throw new ApiRequestError(
        message,
        null,
        undefined,
        error,
        write,
        requestId
      )
    }
    const text = await response.text()
    let parsed: unknown
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
    }
    return { status: response.status, body: parsed, headers: response.headers }
  },
})
