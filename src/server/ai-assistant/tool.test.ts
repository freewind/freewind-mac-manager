import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { TaskRequestIdSchema } from "@shared/api-contract/schemas/common"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  callMacManagerApi,
  requestIdForToolCall,
  resolveApiRequest,
} from "./tool"

const PORT = 1234

/** execute 的第 5 个参数（扩展上下文）在测试里不需要。 */
const runTool = (
  params: { method: string; path: string; body?: unknown },
  options: { signal?: AbortSignal; toolCallId?: string } = {}
) =>
  callMacManagerApi.execute(
    options.toolCallId ?? "call-test-1",
    params,
    options.signal,
    undefined,
    undefined as never
  )

const textOf = (result: { content: unknown }): string =>
  (result.content as Array<{ text: string }>).map((item) => item.text).join("")

describe("resolveApiRequest 规范化与白名单", () => {
  it("合法的本应用路径通过，并给出规范化地址", () => {
    expect(
      resolveApiRequest({ method: "GET", path: "/api/docker/containers" }, PORT)
    ).toMatchObject({
      ok: true,
      request: {
        method: "GET",
        url: `http://127.0.0.1:${PORT}/api/docker/containers`,
        write: false,
      },
    })
    expect(
      resolveApiRequest({ method: "post", path: "/api/processes" }, PORT)
    ).toMatchObject({ ok: true, request: { method: "POST", write: true } })
  })

  it("保留查询串，但用规范化后的路径做检查", () => {
    const decision = resolveApiRequest(
      { method: "GET", path: "/api/files/entries?path=/tmp/a%20b" },
      PORT
    )
    expect(decision).toMatchObject({
      ok: true,
      request: { path: "/api/files/entries?path=/tmp/a%20b" },
    })
  })

  it("拒绝用 .. 或编码绕过 /api/ 前缀与禁区", () => {
    // 规范化后不再是 /api/ 下的路径
    expect(
      resolveApiRequest({ method: "GET", path: "/api/../etc/passwd" }, PORT)
    ).toMatchObject({ ok: false })
    expect(
      resolveApiRequest({ method: "GET", path: "/api/%2e%2e/auth/login" }, PORT)
    ).toMatchObject({ ok: false })
    // 规范化后落到禁区：ai-assistant 与 auth
    expect(
      resolveApiRequest(
        { method: "GET", path: "/api/docker/%2e%2e/ai-assistant/settings" },
        PORT
      )
    ).toMatchObject({ ok: false, reason: expect.stringContaining("禁止调用") })
    expect(
      resolveApiRequest(
        { method: "POST", path: "/api/%2e%2e/api/auth/login" },
        PORT
      )
    ).toMatchObject({ ok: false })
    expect(
      resolveApiRequest(
        { method: "POST", path: "/api/ai-assistant/sessions/x/message" },
        PORT
      )
    ).toMatchObject({ ok: false, reason: expect.stringContaining("禁止调用") })
  })

  it("只允许 127.0.0.1 当前端口，拒绝其它主机或端口", () => {
    expect(
      resolveApiRequest({ method: "GET", path: "//evil.test/api/x" }, PORT)
    ).toMatchObject({ ok: false, reason: expect.stringContaining("只允许") })
    expect(
      resolveApiRequest(
        { method: "GET", path: `http://127.0.0.1:${PORT + 1}/api/x` },
        PORT
      )
    ).toMatchObject({ ok: false })
    expect(
      resolveApiRequest(
        { method: "GET", path: "http://localhost:1234/api/x" },
        PORT
      )
    ).toMatchObject({ ok: false })
  })

  it("拒绝白名单外的 method 与超限请求体", () => {
    expect(
      resolveApiRequest({ method: "OPTIONS", path: "/api/health" }, PORT)
    ).toMatchObject({
      ok: false,
      reason: expect.stringContaining("不支持的 method"),
    })
    expect(
      resolveApiRequest(
        {
          method: "POST",
          path: "/api/processes",
          body: { pad: "x".repeat(300 * 1024) },
        },
        PORT
      )
    ).toMatchObject({ ok: false, reason: expect.stringContaining("256KB") })
  })
})

describe("requestIdForToolCall", () => {
  it("同一 toolCallId 得到同一个合法请求标识", () => {
    const first = requestIdForToolCall("call_00_abcDEF123")
    const second = requestIdForToolCall("call_00_abcDEF123")

    expect(first).toBe(second)
    expect(TaskRequestIdSchema.safeParse(first).success).toBe(true)
    // 不同调用得到不同标识
    expect(requestIdForToolCall("call_00_other")).not.toBe(first)
  })
})

describe("call_mac_manager_api 执行", () => {
  let server: Server
  let requests: Array<{
    method?: string
    url?: string
    authorization?: string
    requestId?: string
  }>
  let respond: (request: { url?: string }) => {
    status: number
    body: string
    headers?: Record<string, string>
  }

  beforeEach(async () => {
    requests = []
    respond = () => ({
      status: 200,
      body: JSON.stringify({ message: "ok" }),
    })
    server = createServer((request, response) => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        requestId:
          typeof request.headers["x-task-request-id"] === "string"
            ? request.headers["x-task-request-id"]
            : undefined,
      })
      const result = respond(request)
      response.writeHead(result.status, {
        "content-type": "application/json",
        ...result.headers,
      })
      response.end(result.body)
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

  it("只读调用打到本机 API，不带任务请求标识", async () => {
    const result = await runTool({ method: "GET", path: "/api/ping" })

    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe("/api/ping")
    expect(requests[0].authorization).toBe("Bearer test-password")
    expect(requests[0].requestId).toBeUndefined()
    expect(textOf(result)).toContain('"status":200')
    expect(result.isError).toBeFalsy()
  })

  it("写操作带稳定请求标识，4xx 记为失败", async () => {
    respond = () => ({ status: 409, body: '{"message":"冲突"}' })
    const first = await runTool(
      { method: "POST", path: "/api/processes/kill", body: { pids: [1] } },
      { toolCallId: "call_00_write" }
    )
    const expectedId = requestIdForToolCall("call_00_write")

    expect(requests[0].requestId).toBe(expectedId)
    expect(TaskRequestIdSchema.safeParse(expectedId).success).toBe(true)
    expect(first.isError).toBe(true)
    expect(textOf(first)).toContain('"status":409')

    await runTool(
      { method: "POST", path: "/api/processes/kill", body: { pids: [1] } },
      { toolCallId: "call_00_write" }
    )
    expect(requests[1].requestId).toBe(expectedId)
  })

  it("202 只当作已接收：带明确说明且不算失败", async () => {
    respond = () => ({
      status: 202,
      body: '{"taskId":"t1","status":"running"}',
    })
    const result = await runTool({
      method: "POST",
      path: "/api/disk-growth/scan",
      body: {},
    })

    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain("任务已接收（202）")
    expect(textOf(result)).toContain("/api/tasks")
  })

  it("5xx 记为失败", async () => {
    respond = () => ({ status: 500, body: '{"message":"炸了"}' })
    const result = await runTool({ method: "GET", path: "/api/health" })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('"status":500')
  })

  it("超大响应读满上限就截断并取消读取", async () => {
    let cancelled = false
    const chunk = "y".repeat(8 * 1024)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 40; index += 1) {
          controller.enqueue(new TextEncoder().encode(chunk))
        }
      },
      cancel() {
        cancelled = true
      },
    })
    const originalFetch = globalThis.fetch
    // 直接给一个超大流，验证有界读取行为
    globalThis.fetch = (async () =>
      ({
        status: 200,
        body: stream,
      }) as unknown as Response) as typeof fetch
    try {
      const result = await runTool({ method: "GET", path: "/api/health" })
      const text = textOf(result)
      expect(text).toContain('"truncated":true')
      expect(text).toContain("已截断")
      expect(text.length).toBeLessThan(64 * 1024 + 512)
      expect(cancelled).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("写操作网络中断时明确结果未知", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch")
    }) as typeof fetch
    try {
      const result = await runTool({
        method: "POST",
        path: "/api/processes/kill",
        body: { pids: [1] },
      })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toContain("结果未知")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("写操作被中止时也明确结果未知", async () => {
    const controller = new AbortController()
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      controller.abort()
      throw Object.assign(new Error("aborted"), { name: "AbortError" })
    }) as typeof fetch
    try {
      const result = await runTool(
        { method: "DELETE", path: "/api/docker/container", body: { id: "c1" } },
        { signal: controller.signal }
      )
      expect(result.isError).toBe(true)
      expect(textOf(result)).toContain("结果未知")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("不跟重定向，被拒绝的路径不发请求", async () => {
    const originalFetch = globalThis.fetch
    let redirectMode: string | undefined
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      redirectMode = init?.redirect
      return { status: 200, body: null } as unknown as Response
    }) as typeof fetch
    try {
      await runTool({ method: "GET", path: "/api/health" })
      expect(redirectMode).toBe("error")

      const before = requests.length
      const rejected = await runTool({
        method: "POST",
        path: "/api/auth/login",
      })
      expect(textOf(rejected)).toContain("调用被拒绝")
      expect(requests.length).toBe(before)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
