import { mkdtemp, rm } from "node:fs/promises"
import http from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { requestJson } from "./transport"

/**
 * 传输层测试全部跑在临时 socket 与临时回环端口上：
 * 不碰真实 /var/run 下的 socket，也不碰真实的 Clash 配置。
 */

type TestServer = {
  socketPath: string
  port: number
  requests: string[]
  authorization: string[]
  closed: () => boolean
  close: () => Promise<void>
}

const startServer = async (
  handler: (
    request: http.IncomingMessage,
    response: http.ServerResponse
  ) => void,
  kind: "unix" | "tcp"
): Promise<TestServer> => {
  const dir = await mkdtemp(path.join(tmpdir(), "clash-sock-"))
  const socketPath = path.join(dir, "ctl.sock")
  const server = http.createServer(handler)
  const requests: string[] = []
  const authorization: string[] = []
  let closed = false
  server.on("request", (request) => {
    requests.push(`${request.method} ${request.url}`)
    authorization.push(String(request.headers.authorization ?? ""))
  })
  server.on("connection", (socket) => {
    socket.on("close", () => {
      closed = true
    })
  })
  await new Promise<void>((resolve) => {
    if (kind === "unix") server.listen(socketPath, resolve)
    else server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  return {
    socketPath,
    port: typeof address === "object" && address ? address.port : 0,
    requests,
    authorization,
    closed: () => closed,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(dir, { recursive: true, force: true })
    },
  }
}

const json = (response: http.ServerResponse, body: unknown, status = 200) => {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify(body))
}

describe("Clash 控制接口传输层", () => {
  const servers: TestServer[] = []
  const originalSecret = process.env.CLASH_VERGE_SECRET
  const originalSocket = process.env.CLASH_VERGE_CONTROLLER_UNIX_SOCKET

  const track = async (server: TestServer) => {
    servers.push(server)
    return server
  }

  beforeEach(() => {
    delete process.env.CLASH_VERGE_SECRET
    delete process.env.CLASH_VERGE_CONTROLLER_UNIX_SOCKET
  })

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()))
    servers.length = 0
    if (originalSecret === undefined) delete process.env.CLASH_VERGE_SECRET
    else process.env.CLASH_VERGE_SECRET = originalSecret
    if (originalSocket === undefined)
      delete process.env.CLASH_VERGE_CONTROLLER_UNIX_SOCKET
    else process.env.CLASH_VERGE_CONTROLLER_UNIX_SOCKET = originalSocket
  })

  it("unix socket 上读 JSON，并按语义区分 401/403/404/429 与其它错误", async () => {
    const server = await track(
      await startServer((request, response) => {
        if (request.url === "/version") {
          json(response, { meta: true, version: "v1.19.32" })
          return
        }
        if (request.url === "/missing") {
          response.writeHead(404)
          response.end("404 page not found")
          return
        }
        if (request.url === "/busy") {
          response.writeHead(429)
          response.end("")
          return
        }
        if (request.url === "/forbidden") {
          response.writeHead(403)
          response.end("")
          return
        }
        response.writeHead(500)
        response.end("")
      }, "unix")
    )
    const target = { kind: "unix" as const, socketPath: server.socketPath }

    await expect(requestJson(target, "/version")).resolves.toEqual({
      meta: true,
      version: "v1.19.32",
    })
    await expect(requestJson(target, "/missing")).rejects.toMatchObject({
      kind: "not_found",
    })
    await expect(requestJson(target, "/busy")).rejects.toMatchObject({
      kind: "rate_limited",
    })
    await expect(requestJson(target, "/forbidden")).rejects.toMatchObject({
      kind: "unauthorized",
    })
    await expect(requestJson(target, "/boom")).rejects.toMatchObject({
      kind: "unavailable",
    })
    expect(server.requests).toHaveLength(5)
  })

  it("unix socket 上只取 /traffic 的第一个 JSON 对象并断开连接", async () => {
    const server = await track(
      await startServer((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" })
        response.write('{"up":1,"down":2}\n')
        // 持续推送：客户端应当只读走第一个对象就断开
        setTimeout(() => response.write('{"up":3,"down":4}\n'), 30)
      }, "unix")
    )

    await expect(
      requestJson({ kind: "unix", socketPath: server.socketPath }, "/traffic", {
        streamFirstObject: true,
      })
    ).resolves.toEqual({ up: 1, down: 2 })
  })

  it("unix socket 上认证头按需携带：无 secret 不带，有 secret 才带", async () => {
    const server = await track(
      await startServer((_request, response) => {
        json(response, { meta: true, version: "v1.19.32" })
      }, "unix")
    )
    const target = { kind: "unix" as const, socketPath: server.socketPath }

    await requestJson(target, "/version")
    expect(server.authorization).toEqual([""])

    process.env.CLASH_VERGE_SECRET = "local-only-secret"
    await requestJson(target, "/version")
    expect(server.authorization[1]).toBe("Bearer local-only-secret")
  })

  it("unix socket 上返回非 JSON 或超时都落成可读错误", async () => {
    const server = await track(
      await startServer((request, response) => {
        if (request.url === "/broken") {
          response.writeHead(200, { "content-type": "application/json" })
          response.end("not-json")
          return
        }
        // 永远不响应，用来触发超时
      }, "unix")
    )
    const target = { kind: "unix" as const, socketPath: server.socketPath }

    await expect(requestJson(target, "/broken")).rejects.toMatchObject({
      kind: "invalid_response",
    })
    await expect(
      requestJson(target, "/slow", { timeoutMs: 120 })
    ).rejects.toMatchObject({
      kind: "unavailable",
      message: expect.stringContaining("超时") as unknown as string,
    })
  })

  it("socket 不存在时落成不可达，而不是崩溃", async () => {
    await expect(
      requestJson(
        { kind: "unix", socketPath: "/tmp/definitely-missing-clash.sock" },
        "/version"
      )
    ).rejects.toMatchObject({ kind: "unavailable" })
  })

  it("回环 TCP 分支仍然用 fetch 语义：地址拼接、认证头与状态码映射一致", async () => {
    const server = await track(
      await startServer((request, response) => {
        if (request.url === "/version") {
          json(response, { meta: true, version: "v1.19.32" })
          return
        }
        response.writeHead(404)
        response.end("")
      }, "tcp")
    )
    const target = {
      kind: "tcp" as const,
      baseUrl: new URL(`http://127.0.0.1:${server.port}`),
    }

    await expect(requestJson(target, "/version")).resolves.toEqual({
      meta: true,
      version: "v1.19.32",
    })
    await expect(requestJson(target, "/missing")).rejects.toMatchObject({
      kind: "not_found",
    })
    expect(server.requests).toEqual(["GET /version", "GET /missing"])
  })
})
