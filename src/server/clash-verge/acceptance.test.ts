import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { stat } from "node:fs/promises"
import type { Server } from "node:http"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Clash 规则读写的端到端自动验收（任务 19/20/26 的收口）。
 *
 * 与既有单测的分工：merge-file / discovery / transport 单测验证各模块内部
 * 语义；本文件从真实 HTTP 入口（createApp + 认证 + 契约路由）与真实控制
 * 接口替身出发，按验收清单逐项断言关键行为。
 *
 * 隔离原则：Merge 路径与任务目录全部指到临时目录；控制接口替身只监听
 * 127.0.0.1 随机端口；约定路径检查只对不存在的 /var/run 路径做 lstat
 * （ENOENT → false），不创建、不连接真实 socket；不读真实 Merge.yaml，
 * 不连真实 Clash Verge 控制接口。
 */

const TEST_PASSWORD = "clash-rules-acceptance-password"
const MERGE_MAX_CHARS = 256 * 1024

/**
 * env.ts 的路径常量在模块加载时求值，早于文件里任何语句，
 * 所以环境必须在 vi.hoisted 里先行设定（vitest 会把它提到 import 之前）。
 */
const envPaths = vi.hoisted(() => {
  const base = `/tmp/mac-manager-clash-acc-${process.pid}`
  const profiles = `${base}/profiles`
  process.env.MAC_MANAGER_PASSWORD = "clash-rules-acceptance-password"
  process.env.CLASH_VERGE_PROFILE_DIR = profiles
  process.env.CLASH_VERGE_MERGE_FILE = `${profiles}/Merge.yaml`
  process.env.CLASH_VERGE_AUTO_DISCOVER = "0"
  delete process.env.CLASH_VERGE_CONTROLLER_URL
  delete process.env.CLASH_VERGE_CONTROLLER_UNIX_SOCKET
  delete process.env.CLASH_VERGE_SECRET
  return { base, profiles, mergeFile: `${profiles}/Merge.yaml` }
})

import { createApp } from "@server/app"
import { TaskStore } from "@server/common/tasks/store"
import { createInlineHost } from "@server/common/tasks/worker-host"
import { createTaskRuntime } from "@server/tasks/runtime"
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import {
  conventionalSocketPaths,
  discoveredCandidates,
  isUsableSocket,
  resetControllerTarget,
  resolveControllerTarget,
} from "./discovery"

const SEED_CONTENT = "# 全局 Merge 验收种子\nproxies: []\n"

let baseUrl = ""
let server: Server | undefined
const upstreams: Server[] = []

mkdirSync(envPaths.profiles, { recursive: true })

beforeAll(async () => {
  const taskDir = mkdtempSync(path.join(tmpdir(), "clash-acc-tasks-"))
  const runtime = createTaskRuntime({
    store: new TaskStore(path.join(taskDir, "tasks.sqlite3")),
    host: createInlineHost(async () => ({
      result: null,
      message: null,
      status: "done" as const,
    })),
    thresholdMs: 20,
  })
  const app = createApp({ tasks: runtime, initializeBusiness: false })
  server = app.listen(0)
  await new Promise((resolve) => server?.once("listening", resolve))
  const address = server?.address()
  const port = typeof address === "object" && address ? address.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(() => {
  server?.closeAllConnections?.()
  server?.close()
  for (const upstream of upstreams) {
    upstream.closeAllConnections?.()
    upstream.close()
  }
  rmSync(envPaths.base, { recursive: true, force: true })
})

const send = async (
  method: string,
  apiPath: string,
  options: { body?: unknown; auth?: boolean } = {}
) => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  }
  if (options.auth !== false) {
    headers.authorization = `Bearer ${TEST_PASSWORD}`
  }
  const response = await fetch(`${baseUrl}${apiPath}`, {
    method,
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  })
  const text = await response.text()
  return {
    status: response.status,
    body:
      text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : null,
  }
}

/** 控制接口替身：所有请求按给定状态码回固定 JSON。 */
const startUpstream = async (status: number): Promise<string> => {
  const upstream = createServer((_request, response) => {
    response.writeHead(status, { "content-type": "application/json" })
    response.end("{}")
  })
  upstreams.push(upstream)
  await new Promise<void>((resolve) =>
    upstream.listen({ port: 0, host: "127.0.0.1" }, resolve)
  )
  const address = upstream.address()
  const port = typeof address === "object" && address ? address.port : 0
  return `http://127.0.0.1:${port}`
}

beforeEach(() => {
  writeFileSync(envPaths.mergeFile, SEED_CONTENT, "utf8")
  chmodSync(envPaths.mergeFile, 0o600)
  resetControllerTarget()
  process.env.CLASH_VERGE_AUTO_DISCOVER = "0"
  delete process.env.CLASH_VERGE_CONTROLLER_URL
  delete process.env.CLASH_VERGE_CONTROLLER_UNIX_SOCKET
  delete process.env.CLASH_VERGE_SECRET
})

describe("Merge 文件端到端验收（任务 19/20）", () => {
  it("读：固定路径回显服务端路径与内容", async () => {
    const response = await send("GET", "/api/clash-verge/merge-file")
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      path: envPaths.mergeFile,
      content: SEED_CONTENT,
    })
    expect(typeof response.body?.modified).toBe("number")
    expect(response.body?.size).toBeGreaterThan(0)
  })

  it("读：文件不存在时 404 并说明原因，不是通用 500", async () => {
    rmSync(envPaths.mergeFile)
    const response = await send("GET", "/api/clash-verge/merge-file")
    expect(response.status).toBe(404)
    expect(String(response.body?.message)).toMatch(
      /找不到 Clash Verge 全局 Merge 文件/
    )
  })

  it("读写：未登录 401，密码错误 401", async () => {
    const anonymousGet = await send("GET", "/api/clash-verge/merge-file", {
      auth: false,
    })
    expect(anonymousGet.status).toBe(401)
    expect(anonymousGet.body).toMatchObject({ message: "需要访问密码" })

    const anonymousPut = await send("PUT", "/api/clash-verge/merge-file", {
      auth: false,
      body: { content: "x" },
    })
    expect(anonymousPut.status).toBe(401)

    const wrong = await fetch(`${baseUrl}/api/clash-verge/merge-file`, {
      method: "PUT",
      headers: {
        authorization: "Bearer wrong-password-value",
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: "x" }),
    })
    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toMatchObject({ message: "密码错误" })
  })

  it("写：原子写替换内容、权限保留、不留临时文件，并提示需重载", async () => {
    const next = "rules:\n  - MATCH,REJECT\n"
    const response = await send("PUT", "/api/clash-verge/merge-file", {
      body: { content: next },
    })
    expect(response.status).toBe(200)
    expect(String(response.body?.message)).toContain(
      "需在 Clash Verge 中重载配置后生效"
    )

    expect(readFileSync(envPaths.mergeFile, "utf8")).toBe(next)
    const info = await stat(envPaths.mergeFile)
    expect(info.mode & 0o777).toBe(0o600)
    const leftovers = readdirSync(envPaths.profiles).filter(
      (name) => name.startsWith(".Merge.") && name.endsWith(".tmp")
    )
    expect(leftovers).toEqual([])

    const readBack = await send("GET", "/api/clash-verge/merge-file")
    expect(readBack.body?.content).toBe(next)
  })

  it("写：内容超上限时契约 400，且原文件不被改动", async () => {
    const before = readFileSync(envPaths.mergeFile, "utf8")
    const response = await send("PUT", "/api/clash-verge/merge-file", {
      body: { content: "x".repeat(MERGE_MAX_CHARS + 1) },
    })
    expect(response.status).toBe(400)
    // ts-rest 的请求校验失败：400 + 序列化的 ZodError，逐条说明超限原因。
    expect(response.body?.name).toBe("ZodError")
    const issues = (
      response.body as {
        issues?: Array<{ code?: string; message?: string; path?: string[] }>
      }
    ).issues
    expect(issues?.[0]).toMatchObject({ code: "too_big", path: ["content"] })
    expect(issues?.[0]?.message).toMatch(/262144/)
    expect(readFileSync(envPaths.mergeFile, "utf8")).toBe(before)
    const leftovers = readdirSync(envPaths.profiles).filter((name) =>
      name.includes(".tmp")
    )
    expect(leftovers).toEqual([])
  })

  it("写：目标是符号链接时读写都拒绝，链接目标不被改写", async () => {
    const outside = path.join(envPaths.base, "outside.yaml")
    writeFileSync(outside, "proxies: []\n# 外部目标\n", "utf8")
    rmSync(envPaths.mergeFile)
    symlinkSync(outside, envPaths.mergeFile)

    const read = await send("GET", "/api/clash-verge/merge-file")
    expect(read.status).toBe(403)
    expect(String(read.body?.message)).toMatch(/符号链接/)

    const write = await send("PUT", "/api/clash-verge/merge-file", {
      body: { content: "hacked: true\n" },
    })
    expect(write.status).toBe(403)
    expect(readFileSync(outside, "utf8")).toContain("外部目标")
  })

  it("安全语义：客户端写操作不自动重试，结果未知须重新读取核实", () => {
    const clientSource = readFileSync(
      fileURLToPath(
        new URL("../../shared/client-api/clash-verge.ts", import.meta.url)
      ),
      "utf8"
    )
    expect(clientSource).toContain("不自动重试")
    expect(clientSource).toContain("结果未知")
    expect(clientSource).toContain("重新读取")
  })
})

describe("控制接口发现与可用性验收（任务 26）", () => {
  it("显式配置优先：存在即权威，不再探测候选", async () => {
    const explicit = await startUpstream(200)
    process.env.CLASH_VERGE_CONTROLLER_URL = explicit
    const target = await resolveControllerTarget({
      candidates: [{ kind: "tcp", baseUrl: new URL("http://127.0.0.1:1") }],
      probeTimeoutMs: 200,
    })
    if (target.kind !== "tcp") {
      throw new Error("显式 URL 应解析为回环 TCP 目标")
    }
    expect(target.baseUrl.href).toBe(new URL(explicit).href)
  })

  it("约定路径只列内核 socket；红鲱鱼与普通文件都不算控制接口", async () => {
    const uid = process.getuid?.() ?? 501
    const paths = conventionalSocketPaths(uid)
    expect(paths).toEqual([
      `/var/run/clash-verge-service/users/${uid}/verge-mihomo.sock`,
    ])
    // 两个红鲱鱼：特权 helper 的 IPC 与 App 单实例通道，必须不在列表内。
    expect(paths.some((item) => item.endsWith("service.sock"))).toBe(false)
    expect(paths.some((item) => item.includes("singleton-instance.json"))).toBe(
      false
    )

    // 普通文件与缺失路径都不是可用 socket。
    const notSocket = path.join(envPaths.base, "service.sock")
    writeFileSync(notSocket, "", "utf8")
    expect(await isUsableSocket(notSocket)).toBe(false)
    expect(await isUsableSocket(`${notSocket}.missing`)).toBe(false)

    // 用户态配置目录里，红鲱鱼文件与非 socket 文件不产生候选。
    const appDir = mkdtempSync(path.join(tmpdir(), "clash-acc-appdir-"))
    try {
      writeFileSync(
        path.join(appDir, "config.yaml"),
        "external-controller: 127.0.0.1:39999\n",
        "utf8"
      )
      writeFileSync(path.join(appDir, "singleton-instance.json"), "{}", "utf8")
      writeFileSync(path.join(appDir, "service.sock"), "", "utf8")
      // 假 uid：本机约定路径可能真实存在，验收不把它当候选、更不连接它。
      const candidates = await discoveredCandidates({
        uid: 99999,
        appDir,
        psOutput: async () => "",
      })
      expect(candidates).toHaveLength(1)
      expect(candidates[0]?.kind).toBe("tcp")
      expect(
        candidates[0]?.kind === "tcp" ? candidates[0].baseUrl.href : ""
      ).toBe("http://127.0.0.1:39999/")
    } finally {
      rmSync(appDir, { recursive: true, force: true })
    }
  })

  it("缓存 30 秒内不重探；全部失败后 5 秒退避，过期才重探", async () => {
    // 打开自动发现才会使用注入的候选；候选由测试给定，不读真实系统。
    delete process.env.CLASH_VERGE_AUTO_DISCOVER
    let probes = 0
    const good = createServer((_request, response) => {
      probes += 1
      response.writeHead(200, { "content-type": "application/json" })
      response.end('{"version":"v1","meta":true}')
    })
    upstreams.push(good)
    await new Promise<void>((resolve) =>
      good.listen({ port: 0, host: "127.0.0.1" }, resolve)
    )
    const goodAddress = good.address()
    const goodPort =
      typeof goodAddress === "object" && goodAddress ? goodAddress.port : 0
    const goodUrl = `http://127.0.0.1:${goodPort}`
    const goodTarget = {
      kind: "tcp" as const,
      baseUrl: new URL(goodUrl),
    }
    const badTarget = {
      kind: "tcp" as const,
      baseUrl: new URL("http://127.0.0.1:1"),
    }

    let now = 1_000_000
    const clock = () => now
    resetControllerTarget()

    // 首次成功 → 缓存。
    const first = await resolveControllerTarget({
      candidates: [goodTarget],
      now: clock,
      probeTimeoutMs: 300,
    })
    if (first.kind !== "tcp") throw new Error("首探应命中 TCP 目标")
    expect(first.baseUrl.href).toBe(new URL(goodUrl).href)
    const probesAfterHit = probes
    expect(probesAfterHit).toBeGreaterThan(0)

    // TTL 内再次解析：直接命中缓存，不再产生探测请求。
    now += 29_000
    const cached = await resolveControllerTarget({
      candidates: [badTarget],
      now: clock,
      probeTimeoutMs: 300,
    })
    if (cached.kind !== "tcp") throw new Error("缓存应是 TCP 目标")
    expect(cached.baseUrl.href).toBe(new URL(goodUrl).href)
    expect(probes).toBe(probesAfterHit)

    // 全部失败 → 记录退避；退避期内不重探，连好候选也不试。
    resetControllerTarget()
    now += 60_000
    await expect(
      resolveControllerTarget({
        candidates: [badTarget],
        now: clock,
        probeTimeoutMs: 200,
      })
    ).rejects.toThrow(/未发现可用的 Clash Verge 控制接口/)
    const probesAfterFailure = probes
    await expect(
      resolveControllerTarget({
        candidates: [goodTarget],
        now: clock,
        probeTimeoutMs: 300,
      })
    ).rejects.toThrow(/未发现可用的 Clash Verge 控制接口/)
    expect(probes).toBe(probesAfterFailure)

    // 退避过期 → 重新探测并成功。
    now += 6_000
    const recovered = await resolveControllerTarget({
      candidates: [goodTarget],
      now: clock,
      probeTimeoutMs: 300,
    })
    if (recovered.kind !== "tcp") throw new Error("退避过期后应命中 TCP 目标")
    expect(recovered.baseUrl.href).toBe(new URL(goodUrl).href)
    expect(probes).toBeGreaterThan(probesAfterFailure)
  })

  it("availability：401/403 报 unauthorized，404/429 报 unavailable 并带具体原因", async () => {
    const cases = [
      { status: 401, state: "unauthorized", message: /认证失败/ },
      { status: 403, state: "unauthorized", message: /认证失败/ },
      { status: 404, state: "unavailable", message: /不支持/ },
      { status: 429, state: "unavailable", message: /频繁/ },
    ]
    for (const item of cases) {
      resetControllerTarget()
      const upstreamUrl = await startUpstream(item.status)
      process.env.CLASH_VERGE_CONTROLLER_URL = upstreamUrl
      const response = await send("GET", "/api/clash-verge/status")
      expect(response.status).toBe(200)
      const availability = response.body?.availability as
        | { state?: string; message?: string | null }
        | undefined
      expect(availability?.state).toBe(item.state)
      expect(String(availability?.message)).toMatch(item.message)
      delete process.env.CLASH_VERGE_CONTROLLER_URL
    }
  })
})

describe("越界拒绝（Merge 路径在配置目录之外）", () => {
  it("读写都拒绝为 403，外部文件不被写入", async () => {
    // 路径常量在 env.ts 模块加载时求值：越界场景需要独立模块实例，
    // 放在文件末尾，避免 resetModules 影响前面的 HTTP 验收用例。
    vi.resetModules()
    const outsideDir = path.join(envPaths.base, "outside")
    mkdirSync(outsideDir, { recursive: true })
    const outsideFile = path.join(outsideDir, "Merge.yaml")
    writeFileSync(outsideFile, "proxies: []\n", "utf8")

    process.env.CLASH_VERGE_PROFILE_DIR = envPaths.profiles
    process.env.CLASH_VERGE_MERGE_FILE = outsideFile
    const service = await import("./service")

    await expect(service.readClashVergeMergeFile()).rejects.toThrow(
      /不在 Clash Verge 配置目录内/
    )
    await expect(
      service.saveClashVergeMergeFile("hacked: true\n")
    ).rejects.toThrow(/不在 Clash Verge 配置目录内/)
    expect(readFileSync(outsideFile, "utf8")).toBe("proxies: []\n")

    // 恢复环境，避免影响同进程后续文件（本文件到此结束）。
    process.env.CLASH_VERGE_MERGE_FILE = envPaths.mergeFile
  })
})
