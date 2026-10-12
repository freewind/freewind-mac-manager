import { mkdtemp, rm } from "node:fs/promises"
import http from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ControllerError, requestControllerJson } from "./controller"
import { resetControllerTarget } from "./discovery"

const original = {
  url: process.env.CLASH_VERGE_CONTROLLER_URL,
  socket: process.env.CLASH_VERGE_CONTROLLER_UNIX_SOCKET,
  secret: process.env.CLASH_VERGE_SECRET,
  auto: process.env.CLASH_VERGE_AUTO_DISCOVER,
}

const restore = (
  key:
    | "CLASH_VERGE_CONTROLLER_URL"
    | "CLASH_VERGE_CONTROLLER_UNIX_SOCKET"
    | "CLASH_VERGE_SECRET"
    | "CLASH_VERGE_AUTO_DISCOVER",
  value: string | undefined
) => {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

afterEach(() => {
  vi.unstubAllGlobals()
  restore("CLASH_VERGE_CONTROLLER_URL", original.url)
  restore("CLASH_VERGE_CONTROLLER_UNIX_SOCKET", original.socket)
  restore("CLASH_VERGE_SECRET", original.secret)
  restore("CLASH_VERGE_AUTO_DISCOVER", original.auto)
  resetControllerTarget()
})

describe("Clash Verge controller", () => {
  it("没有显式配置且关掉自动发现时给出未配置，而不是去猜地址", async () => {
    delete process.env.CLASH_VERGE_CONTROLLER_URL
    delete process.env.CLASH_VERGE_CONTROLLER_UNIX_SOCKET
    delete process.env.CLASH_VERGE_SECRET
    process.env.CLASH_VERGE_AUTO_DISCOVER = "0"

    await expect(requestControllerJson("version")).rejects.toMatchObject({
      kind: "not_configured",
    })
  })

  it("secret 是可选的：没有 secret 也能读，只有配置了才带认证头", async () => {
    process.env.CLASH_VERGE_CONTROLLER_URL = "http://127.0.0.1:9097"
    delete process.env.CLASH_VERGE_SECRET
    const fetchMock = vi.fn(async (_input: URL, init: RequestInit) => {
      expect(new Headers(init.headers).get("authorization")).toBeNull()
      return new Response('{"version":"test"}', { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(requestControllerJson("version")).resolves.toEqual({
      version: "test",
    })
  })

  it("显式配的 unix socket 直接走 socket 传输，不做探测", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "clash-controller-"))
    const socketPath = path.join(dir, "ctl.sock")
    const requests: string[] = []
    const server = http.createServer((request, response) => {
      requests.push(String(request.url))
      response.writeHead(200, { "content-type": "application/json" })
      response.end('{"meta":true,"version":"v1.19.32"}')
    })
    await new Promise<void>((resolve) => server.listen(socketPath, resolve))
    process.env.CLASH_VERGE_CONTROLLER_UNIX_SOCKET = socketPath

    await expect(requestControllerJson("version")).resolves.toEqual({
      meta: true,
      version: "v1.19.32",
    })
    expect(requests).toEqual(["/version"])

    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(dir, { recursive: true, force: true })
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
