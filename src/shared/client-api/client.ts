import { initClient } from "@ts-rest/core"
import { contract } from "@shared/api-contract"

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
    const response = await fetch(path, {
      method,
      headers: requestHeaders,
      body: body as BodyInit | undefined,
      credentials: "same-origin",
    })
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
