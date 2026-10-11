// @vitest-environment jsdom
import { AUTH_COOKIE_NAME } from "@shared/auth"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  buildAuthorizationHeader,
  clearAccessPasswordCookie,
  readAccessPasswordFromCookie,
  writeAccessPasswordCookie,
} from "./access-password"

const clearCookie = (): void => {
  document.cookie = `${AUTH_COOKIE_NAME}=; path=/; Max-Age=0`
}

/**
 * jsdom 的 document.cookie 读不到属性（path / expires / SameSite），
 * 只能抓写入串来断言属性本身。
 */
const captureWrites = (action: () => void): string[] => {
  const writes: string[] = []
  const spy = vi
    .spyOn(Document.prototype, "cookie", "set")
    .mockImplementation((value: string) => {
      writes.push(value)
    })
  try {
    action()
  } finally {
    spy.mockRestore()
  }
  return writes
}

afterEach(clearCookie)

describe("access password cookie", () => {
  it("读写往返保留特殊字符并据此构造 Authorization", () => {
    writeAccessPasswordCookie("a;b=c^d!e", true)
    expect(readAccessPasswordFromCookie()).toBe("a;b=c^d!e")
    expect(buildAuthorizationHeader()).toEqual({
      Authorization: "Bearer a;b=c^d!e",
    })
  })

  it("无 cookie 时返回 null 与空请求头", () => {
    expect(readAccessPasswordFromCookie()).toBeNull()
    expect(buildAuthorizationHeader()).toEqual({})
  })

  it("remember=true 写长期 expires，remember=false 写会话 cookie", () => {
    const remembered = captureWrites(() =>
      writeAccessPasswordCookie("secret", true)
    )
    expect(remembered[0]).toMatch(
      new RegExp(`^${AUTH_COOKIE_NAME}=secret;path=/;SameSite=Strict;expires=`)
    )
    // 非 HttpOnly：前端要读它来填 Authorization 头
    expect(remembered[0]).not.toContain("HttpOnly")
    const expires = /expires=([^;]+)/.exec(remembered[0] ?? "")?.[1]
    expect(new Date(expires ?? "").getFullYear()).toBe(
      new Date().getFullYear() + 10
    )

    const session = captureWrites(() =>
      writeAccessPasswordCookie("secret", false)
    )
    expect(session[0]).toBe(`${AUTH_COOKIE_NAME}=secret;path=/;SameSite=Strict`)
  })

  it("清除时属性与写入一致并置 Max-Age=0", () => {
    const cleared = captureWrites(clearAccessPasswordCookie)
    expect(cleared[0]).toBe(
      `${AUTH_COOKIE_NAME}=; path=/; SameSite=Strict; Max-Age=0`
    )
  })

  it("写入后可以被清除，清掉后不再带 Authorization", () => {
    writeAccessPasswordCookie("secret", true)
    expect(readAccessPasswordFromCookie()).toBe("secret")
    clearAccessPasswordCookie()
    expect(readAccessPasswordFromCookie()).toBeNull()
    expect(buildAuthorizationHeader()).toEqual({})
  })
})
