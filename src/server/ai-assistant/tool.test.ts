import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { callMacManagerApi, validateApiRequest } from "./tool"

/** execute 的第 5 个参数（扩展上下文）在测试里不需要。 */
const runTool = (
  params: { method: string; path: string; body?: unknown },
  signal?: AbortSignal
) =>
  callMacManagerApi.execute(
    "call-test",
    params,
    signal,
    undefined,
    undefined as never
  )

const textOf = (result: { content: unknown }): string =>
  (result.content as Array<{ text: string }>).map((item) => item.text).join("")

describe("call_mac_manager_api 入参校验", () => {
  it("合法的本应用路径通过", () => {
    expect(
      validateApiRequest({ method: "GET", path: "/api/docker/containers" })
    ).toBeNull()
    expect(
      validateApiRequest({
        method: "post",
        path: "/api/processes",
        body: { pids: [1] },
      })
    ).toBeNull()
  })

  it("拒绝 /api/ai-assistant/ 下的端点（防递归调用自己）", () => {
    expect(
      validateApiRequest({
        method: "POST",
        path: "/api/ai-assistant/sessions/x/message",
      })
    ).toContain("禁止调用")
  })

  it("拒绝 /api/auth/ 下的端点（防改访问密码）", () => {
    expect(
      validateApiRequest({ method: "POST", path: "/api/auth/login" })
    ).toContain("禁止调用")
  })

  it("拒绝非 /api/ 前缀的路径", () => {
    expect(validateApiRequest({ method: "GET", path: "/health" })).toContain(
      "/api/"
    )
    expect(
      validateApiRequest({ method: "GET", path: "http://example.test/x" })
    ).toContain("/api/")
  })

  it("拒绝白名单外的 method", () => {
    expect(
      validateApiRequest({ method: "OPTIONS", path: "/api/health" })
    ).toContain("不支持的 method")
  })

  it("拒绝超过 256KB 的请求体", () => {
    expect(
      validateApiRequest({
        method: "POST",
        path: "/api/processes",
        body: { pad: "x".repeat(300 * 1024) },
      })
    ).toContain("256KB")
  })
})

describe("call_mac_manager_api 执行", () => {
  let server: Server
  let requests: Array<{ method?: string; url?: string; authorization?: string }>

  beforeEach(async () => {
    requests = []
    server = createServer((request, response) => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
      })
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ message: "ok", path: request.url }))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    process.env.APP_PORT = String((server.address() as AddressInfo).port)
    process.env.MAC_MANAGER_PASSWORD = "test-password"
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    delete process.env.APP_PORT
    delete process.env.MAC_MANAGER_PASSWORD
  })

  it("合法调用打到本机 API 并带回状态与响应体", async () => {
    const result = await runTool({ method: "GET", path: "/api/ping" })
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe("/api/ping")
    expect(requests[0].authorization).toBe("Bearer test-password")
    expect(textOf(result)).toContain('"status":200')
    expect(textOf(result)).toContain('"message":"ok"')
  })

  it("被拒绝的路径不发出请求", async () => {
    const result = await runTool({ method: "POST", path: "/api/auth/login" })
    expect(requests).toHaveLength(0)
    expect(textOf(result)).toContain("调用被拒绝")
  })
})
