import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import type { Server } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import type { TaskRuntime } from "@server/tasks/runtime"
import { ApiPath } from "@shared/api-path"
import { createExpressEndpoints } from "@ts-rest/express"
import express from "express"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * 走真实 Express + 真实认证中间件：证明新端点的接线与路径没错位，
 * 且未登录读取搜索结果的请求被拒。只读临时目录，不碰真实数据。
 */
const TEST_PASSWORD = "search-test-password"

let root: string
let server: Server | null = null
let baseUrl = ""

const startServer = async (): Promise<void> => {
  vi.stubEnv("MAC_MANAGER_PASSWORD", TEST_PASSWORD)
  vi.resetModules()
  const auth = await import("@server/auth")
  const { createFilesRouter, filesContract } = await import("./handlers")

  const app = express()
  app.use(express.json())
  // 与 app.ts 一致：认证中间件先过，域路由在其后
  app.use(auth.createAuthManager().middleware)
  createExpressEndpoints(
    filesContract,
    createFilesRouter({} as TaskRuntime),
    app,
    { logInitialization: false }
  )

  const listening = app.listen(0)
  await new Promise((resolve) => listening.once("listening", resolve))
  server = listening
  const address = listening.address()
  const port = typeof address === "object" && address ? address.port : 0
  baseUrl = `http://127.0.0.1:${port}`
}

const searchUrl = (rootPath: string): string =>
  `${baseUrl}${ApiPath.filesSearch}?root=${encodeURIComponent(rootPath)}&query=needle&searchContent=true`

beforeEach(() => {
  root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "mac-manager-search-http-"))
  )
  writeFileSync(path.join(root, "alpha.txt"), "first\nneedle here\n")
})

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) {
      resolve()
      return
    }
    server.close(() => resolve())
  })
  server = null
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe("文件搜索端点", () => {
  it("未登录读取搜索返回 401", async () => {
    await startServer()

    const response = await fetch(searchUrl(root))

    expect(response.status).toBe(401)
  })

  it("带访问密码时按契约返回内容命中", async () => {
    await startServer()

    const response = await fetch(searchUrl(root), {
      headers: { authorization: `Bearer ${TEST_PASSWORD}` },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      root: string
      matches: { path: string; source: string; snippet: string | null }[]
      truncated: boolean
    }
    expect(body.root).toBe(root)
    expect(body.truncated).toBe(false)
    expect(body.matches).toHaveLength(1)
    expect(body.matches[0]?.path).toBe(path.join(root, "alpha.txt"))
    expect(body.matches[0]?.source).toBe("content")
    expect(body.matches[0]?.snippet).toBe("needle here")
  })

  it("缺少查询串时按契约拒绝", async () => {
    await startServer()

    const response = await fetch(
      `${baseUrl}${ApiPath.filesSearch}?root=${encodeURIComponent(root)}`,
      { headers: { authorization: `Bearer ${TEST_PASSWORD}` } }
    )

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).toBeLessThan(500)
  })
})
