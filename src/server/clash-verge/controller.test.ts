import { afterEach, describe, expect, it, vi } from "vitest"
import { ControllerError, requestControllerJson } from "./controller"

const originalUrl = process.env.CLASH_VERGE_CONTROLLER_URL
const originalSecret = process.env.CLASH_VERGE_SECRET

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalUrl === undefined) delete process.env.CLASH_VERGE_CONTROLLER_URL
  else process.env.CLASH_VERGE_CONTROLLER_URL = originalUrl
  if (originalSecret === undefined) delete process.env.CLASH_VERGE_SECRET
  else process.env.CLASH_VERGE_SECRET = originalSecret
})

describe("Clash Verge controller", () => {
  it("requires a configured loopback URL and secret", async () => {
    delete process.env.CLASH_VERGE_CONTROLLER_URL
    delete process.env.CLASH_VERGE_SECRET
    await expect(requestControllerJson("version")).rejects.toMatchObject({
      kind: "not_configured",
    })
  })

  it("rejects non-loopback addresses before making a request", async () => {
    process.env.CLASH_VERGE_CONTROLLER_URL = "http://example.com:9097"
    process.env.CLASH_VERGE_SECRET = "private-test-secret"
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    await expect(requestControllerJson("version")).rejects.toMatchObject({
      kind: "not_configured",
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sends bounded GET requests with backend-only authorization", async () => {
    process.env.CLASH_VERGE_CONTROLLER_URL = "http://127.0.0.1:9097"
    process.env.CLASH_VERGE_SECRET = "private-test-secret"
    const fetchMock = vi.fn(async (_input: URL, init: RequestInit) => {
      expect(init.method).toBe("GET")
      expect(init.redirect).toBe("error")
      expect(new Headers(init.headers).get("authorization")).toBe(
        "Bearer private-test-secret"
      )
      return new Response('{"version":"test"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    await expect(requestControllerJson("version")).resolves.toEqual({
      version: "test",
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:9097/version"
    )
  })

  it("maps auth and availability errors without exposing the secret", async () => {
    process.env.CLASH_VERGE_CONTROLLER_URL = "http://127.0.0.1:9097"
    process.env.CLASH_VERGE_SECRET = "never-print-this"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 401 }))
    )
    await expect(requestControllerJson("version")).rejects.toMatchObject({
      kind: "unauthorized",
    })
    try {
      await requestControllerJson("version")
    } catch (error) {
      expect(error).toBeInstanceOf(ControllerError)
      expect(String(error)).not.toContain("never-print-this")
    }
  })

  it("reads only the first traffic object and cancels the stream", async () => {
    process.env.CLASH_VERGE_CONTROLLER_URL = "http://127.0.0.1:9097"
    process.env.CLASH_VERGE_SECRET = "test-secret"
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"up":1,"down":2}\\n'))
      },
      cancel() {
        cancelled = true
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 }))
    )
    await expect(requestControllerJson("traffic")).resolves.toEqual({
      up: 1,
      down: 2,
    })
    expect(cancelled).toBe(true)
  })

  it("rejects malformed and oversized response bodies", async () => {
    process.env.CLASH_VERGE_CONTROLLER_URL = "http://127.0.0.1:9097"
    process.env.CLASH_VERGE_SECRET = "test-secret"
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("not-json", {
            status: 200,
            headers: { "content-type": "application/json" },
          })
      )
    )
    await expect(requestControllerJson("version")).rejects.toMatchObject({
      kind: "invalid_response",
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("x".repeat(4 * 1024 * 1024 + 1), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
      )
    )
    await expect(requestControllerJson("version")).rejects.toMatchObject({
      kind: "invalid_response",
    })
  })
})
