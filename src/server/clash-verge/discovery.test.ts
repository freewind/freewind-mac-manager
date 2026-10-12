import { mkdtemp, rm, writeFile } from "node:fs/promises"
import http from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  candidatesFromConfigTexts,
  candidatesFromProcessArgs,
  conventionalSocketPaths,
  isControllerPayload,
  parseLoopbackTcp,
  resetControllerTarget,
  resolveControllerTarget,
} from "./discovery"

/**
 * 发现逻辑的测试只用临时 socket 与临时文件：
 * 不连真实 /var/run 下的 socket，也不读真实的 Clash 配置。
 */

type TestServer = {
  socketPath: string
  requests: string[]
  close: () => Promise<void>
}

const startServer = async (
  handler: (
    request: http.IncomingMessage,
    response: http.ServerResponse
  ) => void
): Promise<TestServer> => {
  const dir = await mkdtemp(path.join(tmpdir(), "clash-discovery-"))
  const socketPath = path.join(dir, "ctl.sock")
  const server = http.createServer(handler)
  const requests: string[] = []
  server.on("request", (request) => requests.push(String(request.url)))
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))
  return {
    socketPath,
    requests,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(dir, { recursive: true, force: true })
    },
  }
}

const controllerServer = () =>
  startServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" })
    response.end('{"meta":true,"version":"v1.19.32"}')
  })

describe("控制接口候选来源", () => {
  it("只接受回环 TCP 地址", () => {
    expect(parseLoopbackTcp("127.0.0.1:9097")).toEqual({
      kind: "tcp",
      baseUrl: new URL("http://127.0.0.1:9097"),
    })
    expect(parseLoopbackTcp("http://[::1]:9097")).toEqual({
      kind: "tcp",
      baseUrl: new URL("http://[::1]:9097"),
    })
    for (const value of [
      undefined,
      "",
      "example.com:9097",
      "192.168.1.5:9097",
      "0.0.0.0:9097",
      "127.0.0.1",
      "http://user:pass@127.0.0.1:9097",
      "https://127.0.0.1:9097",
    ]) {
      expect(parseLoopbackTcp(value)).toBeNull()
    }
  })

  it("约定路径只列内核自己的 socket，不含 Red Herring", () => {
    const paths = conventionalSocketPaths(501)

    expect(paths).toEqual([
      "/var/run/clash-verge-service/users/501/verge-mihomo.sock",
    ])
    // Clash Verge 特权 helper 的 IPC 与 App 单实例通道都不是控制接口
    expect(paths.join()).not.toContain("service.sock")
    expect(paths.join()).not.toContain("singleton-instance")
  })

  it("用户态配置里 socket 优先，TCP 只在显式打开时才算候选", () => {
    const config = [
      "mixed-port: 7897",
      "external-controller: 127.0.0.1:9097",
      "external-controller-unix: /var/folders/tmp/verge-mihomo.sock",
    ].join("\n")
    const verge = "enable_external_controller: true\n"
    const disabled = "enable_external_controller: false\n"

    expect(
      candidatesFromConfigTexts({
        config,
        clashVerge: "",
        verge,
      })
    ).toEqual([
      { kind: "unix", socketPath: "/var/folders/tmp/verge-mihomo.sock" },
      { kind: "tcp", baseUrl: new URL("http://127.0.0.1:9097") },
    ])
    expect(
      candidatesFromConfigTexts({ config, clashVerge: "", verge: disabled })
    ).toEqual([
      { kind: "unix", socketPath: "/var/folders/tmp/verge-mihomo.sock" },
    ])
    expect(
      candidatesFromConfigTexts({
        config: 'external-controller: ""\n',
        clashVerge: "",
        verge: disabled,
      })
    ).toEqual([])
  })

  it("进程参数里能认出 -ext-ctl-unix 与回环 -ext-ctl，非回环被丢弃", () => {
    const ps = [
      "/Library/Application Support/clash-verge-service/cores/verge-mihomo -d /x -f /y -ext-ctl-unix /var/run/clash-verge-service/users/501/verge-mihomo.sock",
      "/Applications/Clash Verge.app/Contents/MacOS/clash-verge",
      "verge-mihomo -ext-ctl 127.0.0.1:9097",
      "verge-mihomo -ext-ctl 0.0.0.0:9097",
    ].join("\n")

    expect(candidatesFromProcessArgs(ps)).toEqual([
      {
        kind: "unix",
        socketPath: "/var/run/clash-verge-service/users/501/verge-mihomo.sock",
      },
      { kind: "tcp", baseUrl: new URL("http://127.0.0.1:9097") },
    ])
  })

  it("身份校验只认 /version 的形状，别的服务不算控制接口", () => {
    expect(isControllerPayload({ meta: true, version: "v1.19.32" })).toBe(true)
    expect(isControllerPayload({ version: "v1.19.32" })).toBe(false)
    expect(isControllerPayload({ meta: "yes", version: "1" })).toBe(false)
    expect(isControllerPayload("<html>hello</html>")).toBe(false)
    expect(isControllerPayload(null)).toBe(false)
  })
})

describe("控制接口自动发现", () => {
  const servers: TestServer[] = []
  const originals = {
    socket: process.env.CLASH_VERGE_CONTROLLER_UNIX_SOCKET,
    url: process.env.CLASH_VERGE_CONTROLLER_URL,
    auto: process.env.CLASH_VERGE_AUTO_DISCOVER,
  }
  let warn: ReturnType<typeof vi.spyOn>

  const track = async (server: TestServer) => {
    servers.push(server)
    return server
  }

  beforeEach(() => {
    delete process.env.CLASH_VERGE_CONTROLLER_UNIX_SOCKET
    delete process.env.CLASH_VERGE_CONTROLLER_URL
    delete process.env.CLASH_VERGE_AUTO_DISCOVER
    resetControllerTarget()
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
  })

  afterEach(async () => {
    warn.mockRestore()
    await Promise.all(servers.map((server) => server.close()))
    servers.length = 0
    for (const [key, value] of [
      ["CLASH_VERGE_CONTROLLER_UNIX_SOCKET", originals.socket],
      ["CLASH_VERGE_CONTROLLER_URL", originals.url],
      ["CLASH_VERGE_AUTO_DISCOVER", originals.auto],
    ] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    resetControllerTarget()
  })

  it("前面的候选不可用时降级到后面的候选", async () => {
    const live = await track(await controllerServer())

    const target = await resolveControllerTarget({
      candidates: [
        { kind: "unix", socketPath: "/tmp/missing-clash-control.sock" },
        { kind: "unix", socketPath: live.socketPath },
      ],
      probeTimeoutMs: 300,
    })

    expect(target).toEqual({ kind: "unix", socketPath: live.socketPath })
    expect(live.requests).toEqual(["/version"])
  })

  it("命中后缓存 30 秒，超时后重新探测", async () => {
    const live = await track(await controllerServer())
    let now = 1_000_000
    const candidates = [{ kind: "unix" as const, socketPath: live.socketPath }]

    await resolveControllerTarget({ candidates, now: () => now })
    await resolveControllerTarget({ candidates, now: () => now })
    expect(live.requests).toHaveLength(1)

    now += 31_000
    await resolveControllerTarget({ candidates, now: () => now })
    expect(live.requests).toHaveLength(2)
  })

  it("全部候选失败后短暂退避，不每个请求都重跑发现", async () => {
    const notAController = await track(
      await startServer((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" })
        response.end('{"hello":"world"}')
      })
    )
    let now = 2_000_000
    const candidates = [
      { kind: "unix" as const, socketPath: notAController.socketPath },
    ]

    await expect(
      resolveControllerTarget({ candidates, now: () => now })
    ).rejects.toMatchObject({ kind: "not_configured" })
    expect(notAController.requests).toHaveLength(1)

    await expect(
      resolveControllerTarget({ candidates, now: () => now })
    ).rejects.toMatchObject({ kind: "not_configured" })
    expect(notAController.requests).toHaveLength(1)

    now += 6_000
    await expect(
      resolveControllerTarget({ candidates, now: () => now })
    ).rejects.toMatchObject({ kind: "not_configured" })
    expect(notAController.requests).toHaveLength(2)
    expect(warn).toHaveBeenCalled()
  })

  it("显式配置优先，不做探测也不被候选列表影响", async () => {
    const explicit = await track(await controllerServer())
    const other = await track(await controllerServer())
    process.env.CLASH_VERGE_CONTROLLER_UNIX_SOCKET = explicit.socketPath

    const target = await resolveControllerTarget({
      candidates: [{ kind: "unix", socketPath: other.socketPath }],
    })

    expect(target).toEqual({ kind: "unix", socketPath: explicit.socketPath })
    expect(explicit.requests).toEqual([])
    expect(other.requests).toEqual([])
  })

  it("显式 socket 不是 socket 时报未配置，并说明是哪个环境变量", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "clash-not-socket-"))
    const file = path.join(dir, "not-a-socket")
    await writeFile(file, "x")
    process.env.CLASH_VERGE_CONTROLLER_UNIX_SOCKET = file

    await expect(resolveControllerTarget()).rejects.toMatchObject({
      kind: "not_configured",
      message: expect.stringContaining(
        "CLASH_VERGE_CONTROLLER_UNIX_SOCKET"
      ) as unknown as string,
    })
    await rm(dir, { recursive: true, force: true })
  })

  it("关闭自动发现后不再找候选", async () => {
    process.env.CLASH_VERGE_AUTO_DISCOVER = "0"

    await expect(resolveControllerTarget()).rejects.toMatchObject({
      kind: "not_configured",
      message: expect.stringContaining("自动发现已关闭") as unknown as string,
    })
  })

  it("需要 secret 的候选也算命中，交给上层给出认证提示", async () => {
    const secured = await track(
      await startServer((_request, response) => {
        response.writeHead(401)
        response.end("")
      })
    )

    const target = await resolveControllerTarget({
      candidates: [{ kind: "unix", socketPath: secured.socketPath }],
    })

    expect(target).toEqual({ kind: "unix", socketPath: secured.socketPath })
  })
})
