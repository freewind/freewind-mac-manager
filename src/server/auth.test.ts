import { beforeEach, describe, expect, it, vi } from "vitest"
import { type AuthManager, createAuthManager } from "./auth"

type AuthRequest = Parameters<AuthManager["issueCsrf"]>[0]
type AuthResponse = Parameters<AuthManager["issueCsrf"]>[1]

const makeRequest = (cookie = "", csrf = "") => ({
  headers: { cookie },
  ip: "127.0.0.1",
  get: (name: string) =>
    name.toLowerCase() === "x-csrf-token" ? csrf : undefined,
})

const makeResponse = () => ({
  cookies: [] as string[],
  append: (_name: string, value: string) => {
    makeResponseState.cookies.push(value)
  },
})

const makeResponseState = { cookies: [] as string[] }

beforeEach(() => {
  vi.stubEnv("MAC_MANAGER_PASSWORD", "correct horse")
  makeResponseState.cookies = []
})

describe("auth manager", () => {
  it("issues a CSRF token and accepts only the configured password", async () => {
    const manager = createAuthManager()
    const csrfResponse = makeResponse()
    const csrfRequest = makeRequest()
    const token = manager.issueCsrf(
      csrfRequest as AuthRequest,
      csrfResponse as unknown as AuthResponse
    )
    expect(token).toHaveLength(64)

    const response = makeResponse()
    const request = makeRequest(`mac_manager_csrf=${token}`, token)
    expect(
      await manager.login(
        request as AuthRequest,
        response as unknown as AuthResponse,
        "wrong"
      )
    ).toBe(false)
    expect(
      await manager.login(
        request as AuthRequest,
        response as unknown as AuthResponse,
        "correct horse"
      )
    ).toBe(true)
  })

  it("does not accept a session without the CSRF header for writes", () => {
    const manager = createAuthManager()
    const request = makeRequest("mac_manager_csrf=token")
    expect(manager.csrfIsValid(request as AuthRequest)).toBe(false)
  })
})
