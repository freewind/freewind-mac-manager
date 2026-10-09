import { initClient } from "@ts-rest/core"
import { contract } from "@shared/api-contract"

/** 前端统一走相对路径，与服务同端口。 */
export const apiClient = initClient(contract, {
  baseUrl: "",
  api: async ({ path, method, headers, body }) => {
    const response = await fetch(path, {
      method,
      headers,
      body: body as BodyInit | undefined,
    })
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
