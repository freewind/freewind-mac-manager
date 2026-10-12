import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { readFile, stat, writeFile } from "node:fs/promises"
import type { Server } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Merge 文件读写：用环境变量把路径指到临时目录，绝不碰真实 Merge.yaml。
 * 每个用例重置模块并重新导入：路径常量在 env.ts 模块加载时求值，
 * 不重载会读到上一个用例的目录。
 */

const TEST_PASSWORD = "merge-test-password"
let dir: string
let profilesDir: string
let mergeFile: string
let savedPassword: string | undefined

const setupEnv = () => {
  process.env.MAC_MANAGER_PASSWORD = TEST_PASSWORD
  process.env.CLASH_VERGE_PROFILE_DIR = profilesDir
  process.env.CLASH_VERGE_MERGE_FILE = mergeFile
}

const loadService = async () => {
  vi.resetModules()
  setupEnv()
  return import("./service")
}

/** 断言抛出的是带语义状态码的业务错误，而不是通用异常。 */
const expectPublicError = async (
  action: Promise<unknown>,
  status: number,
  messagePart: string
) => {
  // resetModules 后 service 用的是新模块实例，错误类必须从同一注册表取，
  // 否则 instanceof 对不上顶层旧导入。
  const { PublicOperationError } = await import("@server/common/public-error")
  const error = await action.then(
    () => null,
    (caught: unknown) => caught
  )
  expect(error).toBeInstanceOf(PublicOperationError)
  const publicError = error as { status: number; message: string }
  expect(publicError.status).toBe(status)
  expect(publicError.message).toContain(messagePart)
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "clash-merge-"))
  profilesDir = path.join(dir, "profiles")
  mkdirSync(profilesDir)
  mergeFile = path.join(profilesDir, "Merge.yaml")
  savedPassword = process.env.MAC_MANAGER_PASSWORD
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  if (savedPassword === undefined) delete process.env.MAC_MANAGER_PASSWORD
  else process.env.MAC_MANAGER_PASSWORD = savedPassword
  delete process.env.CLASH_VERGE_PROFILE_DIR
  delete process.env.CLASH_VERGE_MERGE_FILE
})

describe("Clash Verge 全局 Merge 读写", () => {
  it("路径固定来自环境配置，读回显服务端路径", async () => {
    const service = await loadService()
    await writeFile(mergeFile, "prepend-rules:\n  - MATCH,REJECT\n", "utf8")
    const result = await service.readClashVergeMergeFile()
    expect(result.path).toBe(mergeFile)
    expect(result.content).toContain("prepend-rules")
    expect(result.size).toBeGreaterThan(0)
    expect(result.modified).toBeGreaterThan(0)
  })

  it("文件不存在时给出明确 404，而不是通用 500", async () => {
    const service = await loadService()
    await expectPublicError(
      service.readClashVergeMergeFile(),
      404,
      "找不到 Clash Verge 全局 Merge 文件"
    )
    await expectPublicError(
      service.saveClashVergeMergeFile("rules: []\n"),
      404,
      "找不到 Clash Verge 全局 Merge 文件"
    )
  })

  it("保存内容超出上限时拒绝，不落盘", async () => {
    const service = await loadService()
    await writeFile(mergeFile, "original\n", "utf8")
    await expectPublicError(
      service.saveClashVergeMergeFile("x".repeat(256 * 1024 + 1)),
      400,
      "超出大小上限"
    )
    expect(await readFile(mergeFile, "utf8")).toBe("original\n")
  })

  it("磁盘文件超出上限时拒绝读取", async () => {
    const service = await loadService()
    // 字节上限是字符上限的 4 倍，写超过该字节数的大文件触发读取拒绝。
    await writeFile(mergeFile, "x".repeat(256 * 1024 * 4 + 1), "utf8")
    await expectPublicError(
      service.readClashVergeMergeFile(),
      403,
      "超出大小上限，拒绝读取"
    )
  })

  it("保存走原子写：内容替换、权限保留、不留临时文件", async () => {
    const service = await loadService()
    await writeFile(mergeFile, "old\n", "utf8")
    await stat(mergeFile)
    const { chmod } = await import("node:fs/promises")
    await chmod(mergeFile, 0o640)
    const message = await service.saveClashVergeMergeFile(
      "prepend-proxy-groups:\n  - name: GLOBAL-GROUP\n"
    )
    expect(message).toContain("已写入")
    expect(message).toContain("重载")
    expect(await readFile(mergeFile, "utf8")).toContain("GLOBAL-GROUP")
    const info = await stat(mergeFile)
    expect(info.mode & 0o777).toBe(0o640)
    const { readdirSync } = await import("node:fs")
    const leftovers = readdirSync(profilesDir).filter((name) =>
      name.endsWith(".tmp")
    )
    expect(leftovers).toEqual([])
  })

  it("目标是符号链接时读写都拒绝", async () => {
    const service = await loadService()
    const outside = path.join(dir, "outside.yaml")
    await writeFile(outside, "outside\n", "utf8")
    symlinkSync(outside, mergeFile)
    await expectPublicError(service.readClashVergeMergeFile(), 403, "符号链接")
    await expectPublicError(
      service.saveClashVergeMergeFile("hacked\n"),
      403,
      "符号链接"
    )
    expect(await readFile(outside, "utf8")).toBe("outside\n")
  })

  it("Merge 文件落在 profiles 目录之外时拒绝（越界）", async () => {
    const escaped = path.join(dir, "escaped.yaml")
    // setupEnv 会把路径写回 profiles/Merge.yaml，必须先跑完再覆盖成越界路径。
    setupEnv()
    process.env.CLASH_VERGE_MERGE_FILE = escaped
    vi.resetModules()
    const service = await import("./service")
    await writeFile(escaped, "data\n", "utf8")
    await expectPublicError(
      service.readClashVergeMergeFile(),
      403,
      "不在 Clash Verge 配置目录内"
    )
  })
})

describe("Clash Verge Merge HTTP 端点", () => {
  let server: Server
  let baseUrl: string

  beforeEach(async () => {
    setupEnv()
    vi.resetModules()
    const express = (await import("express")).default
    const { createExpressEndpoints } = await import("@ts-rest/express")
    const auth = await import("@server/auth")
    const handlers = await import("./handlers")
    const app = express()
    // 与生产 createApp 同一上限：默认 100kb 装不下大请求体，会先被 Express 拒成 413。
    app.use(express.json({ limit: "32mb" }))
    createExpressEndpoints(auth.authContract, auth.createAuthRouter(), app, {
      logInitialization: false,
    })
    app.use(auth.createAuthManager().middleware)
    createExpressEndpoints(
      handlers.clashVergeContract,
      handlers.clashVergeRouter,
      app,
      {
        logInitialization: false,
      }
    )
    server = app.listen(0)
    await new Promise((resolve) => server.once("listening", resolve))
    const address = server.address()
    const port = typeof address === "object" && address ? address.port : 0
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  it("未登录时读写都返回 401", async () => {
    const read = await fetch(`${baseUrl}/api/clash-verge/merge-file`)
    expect(read.status).toBe(401)
    const save = await fetch(`${baseUrl}/api/clash-verge/merge-file`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "rules: []\n" }),
    })
    expect(save.status).toBe(401)
  })

  it("登录后读写闭环，写后读回新内容", async () => {
    await writeFile(
      mergeFile,
      "prepend-rules:\n  - DOMAIN-SUFFIX,example.com,GLOBAL-GROUP\n",
      "utf8"
    )
    const headers = {
      authorization: `Bearer ${TEST_PASSWORD}`,
      "content-type": "application/json",
    }
    const read = await fetch(`${baseUrl}/api/clash-verge/merge-file`, {
      headers,
    })
    expect(read.status).toBe(200)
    const body = (await read.json()) as { path: string; content: string }
    expect(body.path).toBe(mergeFile)
    expect(body.content).toContain("example.com")

    const save = await fetch(`${baseUrl}/api/clash-verge/merge-file`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        content: "prepend-rules:\n  - MATCH,GLOBAL-GROUP\n",
      }),
    })
    expect(save.status).toBe(200)
    const saved = (await save.json()) as { message: string }
    expect(saved.message).toContain("已写入")

    const again = await fetch(`${baseUrl}/api/clash-verge/merge-file`, {
      headers,
    })
    const reread = (await again.json()) as { content: string }
    expect(reread.content).toContain("MATCH,GLOBAL-GROUP")
  })

  it("保存体超上限时由契约校验拒绝为 400", async () => {
    const response = await fetch(`${baseUrl}/api/clash-verge/merge-file`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${TEST_PASSWORD}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: "x".repeat(256 * 1024 + 1) }),
    })
    expect(response.status).toBe(400)
  })
})
