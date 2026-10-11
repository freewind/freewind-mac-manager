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
 * router 不接任何实例，中间件单独新建一个 manager：登录不经过实例、
 * 之后的请求由新实例的中间件放行，就证明核对不依赖进程内实例状态
 * （dev 热重载不会让人被动登出）。
 */
const startServer = async (password: string | null): Promise<TestServer> => {
  vi.resetModules()
  const auth = await import("./auth")
  // 先导入再 stub：env.ts 在导入时读 .env，这里覆盖成用例需要的值。
  vi.stubEnv("MAC_MANAGER_PASSWORD", password ?? "")
  const app = express()
  app.use(express.json())
  createExpressEndpoints(auth.authContract, auth.createAuthRouter(), app, {
    logInitialization: false,
  })
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

  it("锁定期间再失败不重置、不延长锁", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const startedAt = Date.now()
    server = await startServer("correct horse")
    const baseUrl = server.baseUrl

    const failures: Response[] = []
    for (let attempt = 0; attempt < 5; attempt += 1) {
      failures.push(await login(baseUrl, "wrong"))
    }
    expect(failures[4].status).toBe(429)
    // Date 被冻结，锁从这一刻起算 60 秒，剩余秒数必然正好是 60
    const firstRetryAfter = Number(failures[4].headers.get("retry-after"))
    expect(firstRetryAfter).toBe(60)

    // 已在锁定期内再失败一次。
    // recordFailure 在锁定期内直接 return，既有 lockUntil 不动，所以剩余秒数只会
    // 随时间流过而变短；若实现改成「重置或延长锁」，这里会重新回到 60 左右。
    // 这正是「未延长」与「延长」的区分点：只断言 429 是区分不了的。
    vi.setSystemTime(startedAt + 30_000)
    const stillLocked = await login(baseUrl, "wrong")
    expect(stillLocked.status).toBe(429)
    const secondRetryAfter = Number(stillLocked.headers.get("retry-after"))
    expect(secondRetryAfter).toBeGreaterThan(0)
    expect(secondRetryAfter).toBeLessThan(firstRetryAfter)

    // 首次锁定时刻 + 61 秒：锁自然过期，正确密码恢复
    vi.setSystemTime(startedAt + 61_000)
    const recovered = await login(baseUrl, "correct horse")
    expect(recovered.status).toBe(200)
  })

  it("中间件失败计入同一份计数，锁定期内登录端点也被锁定", async () => {
    server = await startServer("correct horse")
    const baseUrl = server.baseUrl

    // 全程不碰登录端点：只用错误 Bearer 打受保护接口，让中间件自己记满失败次数
    const guarded: Response[] = []
    for (let attempt = 0; attempt < 5; attempt += 1) {
      guarded.push(await ping(baseUrl, { authorization: "Bearer wrong" }))
    }
    expect(guarded[4].status).toBe(429)

    // 登录端点读的是同一份计数：正确密码也进不来
    const blocked = await login(baseUrl, "correct horse")
    expect(blocked.status).toBe(429)
    const retryAfter = Number(blocked.headers.get("retry-after"))
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(60)

    // 锁定对中间件同样生效
    expect(
      (await ping(baseUrl, { authorization: "Bearer correct horse" })).status
    ).toBe(429)
  })

  it("登录不经实例、请求由新建 manager 的中间件放行", async () => {
    server = await startServer("correct horse")
    // 登录只经过无状态的 router，随后的 /api 请求由新建 manager 的中间件放行：
    // 凭据核对没有进程内状态。
    expect((await login(server.baseUrl, "correct horse")).status).toBe(200)
    expect(
      (await ping(server.baseUrl, { authorization: "Bearer correct horse" }))
        .status
    ).toBe(200)
  })
})
