import { initClient } from "@ts-rest/core"
import { contract } from "@shared/api-contract"

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly responseBody?: unknown,
    cause?: unknown
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

export const dispatchUnauthorized = (): void => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("mac-manager:unauthorized"))
  }
}

const readCsrfToken = (): string => {
  if (typeof document === "undefined") return ""
  const match = document.cookie.match(/(?:^|; )mac_manager_csrf=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : ""
}

/** 前端统一走相对路径，并在写请求中附带 CSRF token。 */
export const apiClient = initClient(contract, {
  baseUrl: "",
  api: async ({ path, method, headers, body }) => {
    const requestHeaders = new Headers(headers)
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) {
      const csrfToken = readCsrfToken()
      if (csrfToken) requestHeaders.set("x-csrf-token", csrfToken)
    }
    let response: Response
    try {
      response = await fetch(path, {
        method,
        headers: requestHeaders,
        body: body as BodyInit | undefined,
        credentials: "same-origin",
      })
    } catch (error) {
      throw new ApiRequestError("网络请求失败", null, undefined, error)
    }
    if (
      response.status === 401 &&
      !path.startsWith("/api/auth/") &&
      typeof window !== "undefined"
    ) {
      dispatchUnauthorized()
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
