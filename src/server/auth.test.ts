import type { Server } from "node:http"
import { AUTH_COOKIE_NAME } from "@shared/auth"
import { createExpressEndpoints } from "@ts-rest/express"
import express from "express"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * 认证是无状态的：只核对密码，不保存 session。这里用真实 Express 应用 + 真实 HTTP
 * 请求来验证中间件、登录端点与限流行为，不 mock express 内部实现。
 */

type TestServer = { baseUrl: string; close: () => Promise<void> }

let server: TestServer | null = null

/**
 * 每个用例重置模块：限流表是模块级单例，必须拿到干净的计数。
 *
 * 同时创建两个 manager —— router 用 A、中间件用 B。凭据在 A 上登录、在 B 的
 * 中间件下依旧有效，就证明核对不依赖任何实例状态（dev 热重载不会让人被动登出）。
 */
const startServer = async (password: string | null): Promise<TestServer> => {
  vi.resetModules()
  const auth = await import("./auth")
  // 先导入再 stub：env.ts 在导入时读 .env，这里覆盖成用例需要的值。
  vi.stubEnv("MAC_MANAGER_PASSWORD", password ?? "")
  const app = express()
  app.use(express.json())
  createExpressEndpoints(
    auth.authContract,
    auth.createAuthRouter(auth.createAuthManager()),
    app,
    { logInitialization: false }
  )
  app.use(auth.createAuthManager().middleware)
  app.get("/api/ping", (_request, response) => {
    response.json({ ok: true })
  })
  // 非 API 路径必须放行给 SPA（登录界面是前端组件）。
  app.get("/", (_request, response) => {
    response.type("html").send("<html></html>")
  })
  const listening: Server = app.listen(0)
  await new Promise((resolve) => listening.once("listening", resolve))
  const address = listening.address()
  const port = typeof address === "object" && address ? address.port : 0
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        listening.close(() => resolve())
      }),
  }
}

const login = (baseUrl: string, password: string) =>
  fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  })

const ping = (baseUrl: string, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}/api/ping`, { headers })

const cookieHeader = (password: string) =>
  `${AUTH_COOKIE_NAME}=${encodeURIComponent(password)}`

afterEach(async () => {
  await server?.close()
  server = null
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe("access password auth", () => {
  it("登录成功返回 200，且响应不写任何 cookie", async () => {
    server = await startServer("correct horse")
    const response = await login(server.baseUrl, "correct horse")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ authenticated: true })
    // 无状态认证不落任何 Set-Cookie（密码 cookie 由前端自己写）。
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it("中间件只拦 /api，放行 SPA；Bearer 优先，其次 cookie", async () => {
    server = await startServer("correct horse")
    const baseUrl = server.baseUrl

    // 非 API 交给 SPA
    expect((await fetch(`${baseUrl}/`)).status).toBe(200)
    // 无凭据拒绝
    const unauthorized = await ping(baseUrl)
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.headers.getSetCookie()).toEqual([])
    // query 参数取 token 被禁用
    expect(
      (await fetch(`${baseUrl}/api/ping?token=correct%20horse`)).status
    ).toBe(401)
    // Bearer 与 cookie 都可认证
    expect(
      (await ping(baseUrl, { authorization: "Bearer correct horse" })).status
    ).toBe(200)
    expect(
      (await ping(baseUrl, { cookie: cookieHeader("correct horse") })).status
    ).toBe(200)
    // Bearer 优先：Bearer 错误时，正确的 cookie 不能兜底
    expect(
      (
        await ping(baseUrl, {
          authorization: "Bearer wrong",
          cookie: cookieHeader("correct horse"),
        })
      ).status
    ).toBe(401)
    // 错误密码
    expect(
      (await ping(baseUrl, { authorization: "Bearer wrong" })).status
    ).toBe(401)
  })

  it("status 端点按凭据回答 authenticated，未配置时回答 configured=false", async () => {
    server = await startServer("correct horse")
    const baseUrl = server.baseUrl
    expect(await (await fetch(`${baseUrl}/api/auth/status`)).json()).toEqual({
      authenticated: false,
      configured: true,
    })
    expect(
      await (
        await fetch(`${baseUrl}/api/auth/status`, {
          headers: { authorization: "Bearer correct horse" },
        })
      ).json()
    ).toEqual({ authenticated: true, configured: true })

    await server.close()
    server = await startServer(null)
    expect(
      await (await fetch(`${server.baseUrl}/api/auth/status`)).json()
    ).toEqual({ authenticated: false, configured: false })
  })

  it("未配置密码时 fail-closed：中间件与登录都拒绝", async () => {
    server = await startServer(null)
    expect(
      (await ping(server.baseUrl, { authorization: "Bearer anything" })).status
    ).toBe(401)
    const response = await login(server.baseUrl, "anything")
    expect(response.status).toBe(401)
    // 文案不区分「密码错」与「未配置」
    expect(await response.json()).toEqual({
      message: "密码错误或服务尚未配置密码",
    })
  })

  it("连续失败会锁定，返回 429 与 Retry-After；中间件与登录共用同一份计数", async () => {
    server = await startServer("correct horse")
    const baseUrl = server.baseUrl
    let status = 0
    for (let attempt = 0; attempt < 5; attempt += 1) {
      status = (await login(baseUrl, "wrong")).status
    }
    expect(status).toBe(429)

    const locked = await login(baseUrl, "correct horse")
    expect(locked.status).toBe(429)
    const retryAfter = Number(locked.headers.get("retry-after"))
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(60)
    // 锁定期间正确凭据同样被拒：限制不是 per-凭据
    expect(
      (await ping(baseUrl, { authorization: "Bearer correct horse" })).status
    ).toBe(429)
  })

  it("锁过期后正确密码可以恢复", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const startedAt = Date.now()
    server = await startServer("correct horse")
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login(server.baseUrl, "wrong")
    }
    expect((await login(server.baseUrl, "correct horse")).status).toBe(429)

    vi.setSystemTime(startedAt + 61_000)
    const recovered = await login(server.baseUrl, "correct horse")
    expect(recovered.status).toBe(200)
    expect(await recovered.json()).toEqual({ authenticated: true })
  })

  it("同一进程内两次 createAuthManager() 后凭据仍有效", async () => {
    server = await startServer("correct horse")
    // router 与 middleware 分别来自两个 manager（见 startServer）：
    // 在其中一个上完成登录，凭据在另一个的中间件下依然有效。
    expect((await login(server.baseUrl, "correct horse")).status).toBe(200)
    expect(
      (await ping(server.baseUrl, { authorization: "Bearer correct horse" }))
        .status
    ).toBe(200)
  })
})
