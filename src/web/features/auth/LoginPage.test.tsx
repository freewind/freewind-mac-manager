// @vitest-environment jsdom
import { AUTH_COOKIE_NAME } from "@shared/auth"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LoginPage } from "./LoginPage"

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

const renderPage = (onAuthenticated: () => void, configured = true) =>
  render(
    <LoginPage configured={configured} onAuthenticated={onAuthenticated} />
  )

/** jsdom 的 document.cookie 读不到属性，只能抓写入串断言 expires。 */
const captureCookieWrites = () => {
  const writes: string[] = []
  const spy = vi
    .spyOn(Document.prototype, "cookie", "set")
    .mockImplementation((value: string) => {
      writes.push(value)
    })
  return { writes, restore: () => spy.mockRestore() }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.cookie = `${AUTH_COOKIE_NAME}=; path=/; Max-Age=0`
})

describe("访问密码登录页", () => {
  it("默认勾选记住密码，成功后写入长期 cookie 并回调", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ authenticated: true }, 200))
    )
    const onAuthenticated = vi.fn()
    const writes = captureCookieWrites()
    renderPage(onAuthenticated)

    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe(
      "true"
    )

    await userEvent.type(screen.getByLabelText("密码"), "secret")
    await userEvent.click(screen.getByRole("button", { name: "登录" }))

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1))
    writes.restore()
    expect(writes.writes[0]).toMatch(
      new RegExp(`^${AUTH_COOKIE_NAME}=secret;path=/;SameSite=Strict;expires=`)
    )
  })

  it("取消勾选后写入会话 cookie（无 expires）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ authenticated: true }, 200))
    )
    const writes = captureCookieWrites()
    renderPage(vi.fn())

    await userEvent.click(screen.getByRole("checkbox"))
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe(
      "false"
    )
    await userEvent.type(screen.getByLabelText("密码"), "secret")
    await userEvent.click(screen.getByRole("button", { name: "登录" }))

    await waitFor(() => expect(writes.writes).toHaveLength(1))
    writes.restore()
    expect(writes.writes[0]).toBe(
      `${AUTH_COOKIE_NAME}=secret;path=/;SameSite=Strict`
    )
  })

  it("密码错误时显示服务端提示，且不写 cookie", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ message: "密码错误或服务尚未配置密码" }, 401))
    )
    const onAuthenticated = vi.fn()
    renderPage(onAuthenticated)

    await userEvent.type(screen.getByLabelText("密码"), "wrong")
    await userEvent.click(screen.getByRole("button", { name: "登录" }))

    expect(await screen.findByText("密码错误或服务尚未配置密码")).toBeTruthy()
    expect(onAuthenticated).not.toHaveBeenCalled()
    expect(document.cookie).not.toContain(AUTH_COOKIE_NAME)
  })

  it("未配置密码时不显示密码框，只显示提示", () => {
    renderPage(vi.fn(), false)
    expect(screen.queryByLabelText("密码")).toBeNull()
    expect(
      screen.getByText(/服务尚未配置密码。请设置 MAC_MANAGER_PASSWORD 后重启。/)
    ).toBeTruthy()
  })
})
