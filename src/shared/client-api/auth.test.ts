// @vitest-environment jsdom
import { AUTH_COOKIE_NAME } from "@shared/auth"
import { afterEach, describe, expect, it, vi } from "vitest"
import { readAccessPasswordFromCookie } from "./access-password"
import { fetchAuthStatus, login } from "./auth"

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

afterEach(() => {
  vi.unstubAllGlobals()
  document.cookie = `${AUTH_COOKIE_NAME}=; path=/; Max-Age=0`
})

describe("auth client", () => {
  it("登录成功只调端点，不自己写 cookie", async () => {
    const fetchMock = vi.fn(async () => json({ authenticated: true }, 200))
    vi.stubGlobal("fetch", fetchMock)
    await login("secret")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // 写 cookie 是 LoginPage 的职责：它才知道「记住密码」勾没勾
    expect(readAccessPasswordFromCookie()).toBeNull()
  })

  it("登录失败抛出服务端文案且不写 cookie", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ message: "密码错误" }, 401))
    )
    await expect(login("wrong")).rejects.toThrow("密码错误")
    expect(readAccessPasswordFromCookie()).toBeNull()
  })

  it("限流时用服务端文案提示剩余秒数", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ message: "尝试过于频繁，请 42 秒后重试" }, 429))
    )
    await expect(login("wrong")).rejects.toThrow("请 42 秒后重试")
  })

  it("status 直接返回契约结构", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ authenticated: false, configured: true }, 200))
    )
    expect(await fetchAuthStatus()).toEqual({
      authenticated: false,
      configured: true,
    })
  })
})
