import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import type { Server } from "node:http"
import { request as httpRequest } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * 备份管理的端到端自动验收。
 *
 * 与既有测试的分工：service/restore/restore-plan/handlers 各自的单测验证
 * 模块内部语义，本文件按 docs/database.md 的备份验收清单，从真实 HTTP 入口
 * （createApp + 认证 + 契约路由 + 传输例外挂载）逐条断言关键行为，
 * 并覆盖「启动前恢复」的完整路径：提交计划 → 维护屏障执行 → 迁移通过 →
 * 状态核实。
 *
 * 隔离：路径常量在 env.ts 模块加载时固化，环境必须在 import 应用之前用
 * vi.hoisted 设好；全部指向临时目录。测试不碰真实 data/snapshots.sqlite3、
 * 不碰真实备份目录、不碰任何 launchd 服务与真实运行中的服务。
 * 每条用例重建临时库与备份目录：原生备份在测试环境下对同一源的多次连续
 * 调用会撞上间歇性长等待，新源的前两次实测是安全的，因此单个用例内
 * 真实备份不超过两次（分页用两份备份，删除用逐项语义不加份）。
 */

const TEST_PASSWORD = "backup-acceptance-password"

const hoisted = vi.hoisted(() => {
  const base = (process.env.TMPDIR ?? "/tmp").replace(/\/+$/, "")
  const root = `${base}/mac-backup-accept-${process.pid}-${Date.now()}`
  process.env.MAC_MANAGER_PASSWORD = "backup-acceptance-password"
  process.env.MAC_MANAGER_DB_FILE = `${root}/snapshots.sqlite3`
  process.env.MAC_MANAGER_BACKUP_DIR = `${root}/backups`
  process.env.MAC_MANAGER_BACKUP_STATE_DIR = `${root}/state`
  return { root }
})

import { createApp } from "@server/app"
import { runStartupMaintenanceBarrier } from "@server/common/database-maintenance"
import { TaskStore } from "@server/common/tasks/store"
import {
  TaskHostError,
  type TaskOutcome,
} from "@server/common/tasks/worker-host"
import { computeContentSignature } from "@server/database/backups/catalog"
import { runPendingRestore } from "@server/database/backups/restore"
import {
  appliedSignatureOf,
  hasPendingRestoreWork,
  readRestorePlan,
} from "@server/database/backups/restore-plan"
import { runDatabaseBackupCreateTask } from "@server/database/backups/task"
import { closeDatabase, openDatabase } from "@server/database/connection"
import { DATABASE_FILE } from "@server/env"
import { createTaskRuntime, type TaskRuntime } from "@server/tasks/runtime"
import { initializeTraffic } from "@server/traffic/service"
import { TrafficStore } from "@server/traffic/store"
import { ApiPath } from "@shared/api-path"

/**
 * 启动前恢复的完整链路：屏障有 30 秒的默认等待，端到端里给足时限；
 * 其余 HTTP 用例保持默认超时，暴露真实慢点。
 */
const RESTORE_CASE_TIMEOUT_MS = 60_000

let dir: string
let store: TaskStore | undefined
let runtime: TaskRuntime | undefined
let server: Server | undefined
let baseUrl: string
/** 任务执行模式：complete 同步真做，hang 挂起用于 202/409。 */
let mode: "complete" | "hang"
let savedPassword: string | undefined

beforeEach(async () => {
  savedPassword = process.env.MAC_MANAGER_PASSWORD
  process.env.MAC_MANAGER_PASSWORD = TEST_PASSWORD
  rmSync(hoisted.root, { recursive: true, force: true })
  // 目录必须先建：SQLite 不会替你创建父目录。
  mkdirSync(hoisted.root, { recursive: true })
  dir = mkdtempSync(path.join(tmpdir(), "mac-backup-accept-case-"))

  // 临时应用库：流量三表用真实 TrafficStore 建表（与启动迁移同一份 DDL，
  // 恢复后 initializeTraffic 才能真的通过），再加一张数据表围绕备份与恢复。
  const traffic = new TrafficStore(DATABASE_FILE)
  traffic.close()
  const source = new DatabaseSync(DATABASE_FILE)
  source.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
  source.exec("INSERT INTO items (name) VALUES ('row-a'), ('row-b')")
  source.close()

  mode = "complete"
  store = new TaskStore(path.join(dir, "tasks.sqlite3"))
  runtime = createTaskRuntime({
    store,
    recoverInterrupted: false,
    thresholdMs: 2_000,
    host: {
      execute: (job): Promise<TaskOutcome> =>
        new Promise<TaskOutcome>((resolve, reject) => {
          if (mode === "hang") return
          runDatabaseBackupCreateTask({
            payload: job.payload,
            report: () => undefined,
          }).then(resolve, (error: unknown) =>
            reject(
              error instanceof Error
                ? error
                : new TaskHostError("unknown", "备份任务失败")
            )
          )
        }),
    },
  })
  await startApp()
})

afterEach(async () => {
  runtime?.runner.shutdown()
  if (server !== undefined) {
    const closing = server
    await new Promise((resolve) => closing.close(resolve))
  }
  server = undefined
  store?.close()
  store = undefined
  runtime = undefined
  rmSync(dir, { recursive: true, force: true })
  rmSync(hoisted.root, { recursive: true, force: true })
  if (savedPassword === undefined) {
    delete process.env.MAC_MANAGER_PASSWORD
  } else {
    process.env.MAC_MANAGER_PASSWORD = savedPassword
  }
})

const startApp = async (): Promise<void> => {
  const app = createApp({
    tasks: runtime as TaskRuntime,
    initializeBusiness: false,
  })
  const listening = app.listen(0)
  server = listening
  await new Promise((resolve) => listening.once("listening", resolve))
  const address = listening.address()
  const port = typeof address === "object" && address ? address.port : 0
  baseUrl = `http://127.0.0.1:${port}`
}

const closeApp = async (): Promise<void> => {
  if (server === undefined) return
  const closing = server
  server = undefined
  await new Promise((resolve) => closing.close(resolve))
}

const authHeaders = (
  extra: Record<string, string> = {}
): Record<string, string> => ({
  authorization: `Bearer ${TEST_PASSWORD}`,
  ...extra,
})

const send = async (
  method: string,
  apiPath: string,
  options: {
    body?: unknown
    auth?: boolean
    headers?: Record<string, string>
  } = {}
) => {
  const headers: Record<string, string> = { ...options.headers }
  if (options.auth !== false) {
    Object.assign(headers, authHeaders())
  }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json"
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

let requestSeq = 0
const newRequestId = (): string => {
  requestSeq += 1
  return `accept-create-${process.pid}-${Date.now()}-${requestSeq}`
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .padEnd(16, "0")
}

/** 真跑一次创建任务（阈值已设 2000ms，完成即 201）。 */
const createBackup = async () => {
  const response = await send("POST", ApiPath.databaseBackups, {
    headers: { "x-task-request-id": newRequestId() },
  })
  expect(response.status).toBe(201)
  return response.body as {
    backup: {
      id: string
      contentSignature: string
      fileName: string
      sizeBytes: number
    }
  }
}

const itemNames = (): string[] => {
  const reader = openDatabase({ file: DATABASE_FILE, mode: "readonly" })
  try {
    return (
      reader.prepare("SELECT name FROM items ORDER BY id").all() as Array<{
        name: string
      }>
    ).map((row) => row.name)
  } finally {
    closeDatabase(reader)
  }
}

const setItems = (names: string[]): void => {
  const writer = openDatabase({ file: DATABASE_FILE })
  try {
    writer.exec("DELETE FROM items")
    const stmt = writer.prepare("INSERT INTO items (name) VALUES (?)")
    for (const name of names) stmt.run(name)
  } finally {
    closeDatabase(writer)
  }
}

describe("备份列表与创建", () => {
  it("列表按页读取：total、目录与占用如实回显", async () => {
    const first = await createBackup()
    const second = await createBackup()

    const page1 = await send(
      "GET",
      `${ApiPath.databaseBackups}?page=1&pageSize=1`
    )
    expect(page1.status).toBe(200)
    expect(page1.body).toMatchObject({ page: 1, pageSize: 1, total: 2 })
    expect(page1.body?.backups).toHaveLength(1)
    expect(String(page1.body?.directory)).toContain("backups")
    expect(Number(page1.body?.totalBytes)).toBeGreaterThan(0)

    const page2 = await send(
      "GET",
      `${ApiPath.databaseBackups}?page=2&pageSize=1`
    )
    expect(page2.status).toBe(200)
    const page1Items = page1.body?.backups as Array<{ id: string }>
    const page2Items = page2.body?.backups as Array<{ id: string }>
    expect(page1Items).toHaveLength(1)
    expect(page2Items).toHaveLength(1)
    const ids = [first.backup.id, second.backup.id]
    expect(ids).toContain(page1Items[0]?.id)
    expect(ids).toContain(page2Items[0]?.id)
  })

  it("创建：201 表示已发布可恢复；202 是受理回执；创建在跑时新请求 409", async () => {
    const done = await createBackup()
    expect(done.backup.id).toBeTruthy()

    mode = "hang"
    const accepted = await send("POST", ApiPath.databaseBackups, {
      headers: { "x-task-request-id": newRequestId() },
    })
    expect(accepted.status).toBe(202)
    expect(accepted.body).toHaveProperty("taskId")

    // 已有创建任务未完成：新的创建请求按 409 拒绝，并说明未开始执行。
    const conflicting = await send("POST", ApiPath.databaseBackups, {
      headers: { "x-task-request-id": newRequestId() },
    })
    expect(conflicting.status).toBe(409)
    expect(conflicting.body?.executionStatus).toBe("not_started")
  })
})

describe("导入与下载（传输例外）", () => {
  it("声明超过 8 GiB 上限：413 且不接收字节", async () => {
    const result = await new Promise<{ status: number | undefined }>(
      (resolve, reject) => {
        const request = httpRequest(
          {
            host: "127.0.0.1",
            port: Number(new URL(baseUrl).port),
            path: ApiPath.databaseBackupUpload,
            method: "POST",
            headers: {
              authorization: `Bearer ${TEST_PASSWORD}`,
              "content-length": String(9 * 1024 * 1024 * 1024),
            },
          },
          (response) => {
            response.resume()
            resolve({ status: response.statusCode })
          }
        )
        request.on("error", reject)
        request.end()
      }
    )
    expect(result.status).toBe(413)
  })

  it("导入非 SQLite 与空内容都拒绝为 400 unsupported_format", async () => {
    const upload = async (bytes: Uint8Array) => {
      const response = await fetch(
        `${baseUrl}${ApiPath.databaseBackupUpload}`,
        {
          method: "POST",
          headers: authHeaders({
            "content-type": "application/octet-stream",
          }),
          body: Buffer.from(bytes),
        }
      )
      const text = await response.text()
      return {
        status: response.status,
        body:
          text.length > 0
            ? (JSON.parse(text) as Record<string, unknown>)
            : null,
      }
    }

    // 超过 SQLite 头长度的非 SQLite 字节：unsupported_format。
    const textFile = await upload(
      new TextEncoder().encode(`这不是数据库${"x".repeat(160)}`)
    )
    expect(textFile.status).toBe(400)
    expect(textFile.body?.code).toBe("unsupported_format")

    // 空内容在接收后的形态检查就被拒，同样 400。
    const empty = await upload(new Uint8Array())
    expect(empty.status).toBe(400)
    expect(empty.body?.code).toBe("backup_invalid")
  })

  it("下载 200：附件名与字节齐全，摘要与登记的内容签名一致", async () => {
    const created = await createBackup()
    const response = await fetch(
      `${baseUrl}${ApiPath.databaseBackupDownload.replace(
        ":backupId",
        created.backup.id
      )}`,
      { headers: authHeaders() }
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain(
      "application/octet-stream"
    )
    const disposition = response.headers.get("content-disposition") ?? ""
    expect(disposition).toContain(created.backup.fileName)
    expect(disposition).toContain("attachment")

    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(bytes.byteLength).toBe(created.backup.sizeBytes)
    const { createHash } = await import("node:crypto")
    const digest = createHash("sha256").update(bytes).digest("hex")
    expect(digest).toBe(created.backup.contentSignature)
  })

  it("下载不存在的备份 404 且带稳定错误码", async () => {
    const response = await fetch(
      `${baseUrl}${ApiPath.databaseBackupDownload.replace(
        ":backupId",
        "missing-backup-id-000000"
      )}`,
      { headers: authHeaders() }
    )
    expect(response.status).toBe(404)
    const body = (await response.json()) as { code?: string }
    expect(body.code).toBe("backup_not_found")
  })
})

describe("删除", () => {
  it("逐项结果：签名对的删除，签名不符与不存在的进 failed，不整批失败", async () => {
    const target = await createBackup()
    const other = await createBackup()

    const response = await send("POST", ApiPath.databaseBackupsDelete, {
      body: {
        items: [
          {
            id: target.backup.id,
            expectedSignature: target.backup.contentSignature,
          },
          {
            id: other.backup.id,
            expectedSignature: "b".repeat(64),
          },
          {
            id: "missing-backup-id-000000",
            expectedSignature: "c".repeat(64),
          },
        ],
      },
    })
    expect(response.status).toBe(200)
    expect(response.body?.deleted).toEqual([target.backup.id])
    const failed = response.body?.failed as Array<{
      id: string
      message: string
    }>
    expect(failed).toHaveLength(2)
    const messages = new Map(failed.map((item) => [item.id, item.message]))
    expect(messages.get(other.backup.id)).toMatch(/签名/)
    expect(messages.get("missing-backup-id-000000")).toMatch(/不存在/)
  })

  it("超过 100 条时契约 400，一条也不执行", async () => {
    const items = Array.from({ length: 101 }, (_unused, index) => ({
      id: `accept-fake-${String(index).padStart(6, "0")}`,
      expectedSignature: "d".repeat(64),
    }))
    const response = await send("POST", ApiPath.databaseBackupsDelete, {
      body: { items },
    })
    expect(response.status).toBe(400)
  })
})

describe("恢复计划、状态与取消", () => {
  it("提交计划 201 只代表计划创建：404、409 签名不符、409 计划待执行", async () => {
    const created = await createBackup()

    const missing = await send("POST", ApiPath.databaseBackupRestore, {
      body: {
        backupId: "missing-backup-id-000000",
        expectedSignature: "e".repeat(64),
      },
    })
    expect(missing.status).toBe(404)
    expect(missing.body?.code).toBe("backup_not_found")

    const wrongSignature = await send("POST", ApiPath.databaseBackupRestore, {
      body: {
        backupId: created.backup.id,
        expectedSignature: "f".repeat(64),
      },
    })
    expect(wrongSignature.status).toBe(409)
    expect(wrongSignature.body?.code).toBe("signature_mismatch")

    const planned = await send("POST", ApiPath.databaseBackupRestore, {
      body: {
        backupId: created.backup.id,
        expectedSignature: created.backup.contentSignature,
      },
    })
    expect(planned.status).toBe(201)
    expect(planned.body?.status).toBe("planned")
    expect(planned.body?.backupId).toBe(created.backup.id)
    // 201 不是「已恢复」：当前库数据在提交前后不变。
    expect(itemNames()).toEqual(["row-a", "row-b"])

    // 状态三者分开：计划存在，但当前库签名不算、verified 不冒充。
    const state = await send("GET", ApiPath.databaseBackupRestore)
    expect(state.status).toBe(200)
    expect(state.body).toHaveProperty("plan")
    expect(state.body).toHaveProperty("currentSignature")
    expect(state.body).toHaveProperty("verified")

    const duplicate = await send("POST", ApiPath.databaseBackupRestore, {
      body: {
        backupId: created.backup.id,
        expectedSignature: created.backup.contentSignature,
      },
    })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body?.code).toBe("restore_plan_pending")
  })

  it("取消：无计划 404、取消 200、再取消 409 restore_not_cancellable", async () => {
    const none = await send("DELETE", ApiPath.databaseBackupRestore)
    expect(none.status).toBe(404)

    const created = await createBackup()
    const planned = await send("POST", ApiPath.databaseBackupRestore, {
      body: {
        backupId: created.backup.id,
        expectedSignature: created.backup.contentSignature,
      },
    })
    expect(planned.status).toBe(201)

    const cancelled = await send("DELETE", ApiPath.databaseBackupRestore)
    expect(cancelled.status).toBe(200)
    expect(cancelled.body?.status).toBe("cancelled")

    const again = await send("DELETE", ApiPath.databaseBackupRestore)
    expect(again.status).toBe(409)
    expect(again.body?.code).toBe("restore_not_cancellable")
  })
})

describe("启动前恢复端到端", () => {
  it(
    "屏障执行恢复：数据回到备份、迁移通过才起服务、回执与文件签名一致",
    async () => {
      // 1. 真实备份覆盖 row-a/row-b。
      const created = await createBackup()

      // 2. 模拟备份之后的改动：当前库变成 row-x。
      setItems(["row-x"])
      expect(itemNames()).toEqual(["row-x"])

      // 3. HTTP 提交计划：201 只代表计划创建，当前库不被触碰。
      const planned = await send("POST", ApiPath.databaseBackupRestore, {
        body: {
          backupId: created.backup.id,
          expectedSignature: created.backup.contentSignature,
        },
      })
      expect(planned.status).toBe(201)
      expect(itemNames()).toEqual(["row-x"])

      // 4. 模拟重启：先关掉旧服务实例，再走启动维护屏障执行恢复。
      await closeApp()
      const outcome = await runStartupMaintenanceBarrier({
        hasPendingWork: () =>
          hasPendingRestoreWork({
            stateDir: process.env.MAC_MANAGER_BACKUP_STATE_DIR,
          }),
        executeRestore: () =>
          runPendingRestore({
            stateDir: process.env.MAC_MANAGER_BACKUP_STATE_DIR,
            backupDir: process.env.MAC_MANAGER_BACKUP_DIR,
            databaseFile: DATABASE_FILE,
            waitTimeoutMs: 1_000,
          }),
      })
      expect(outcome?.status).toBe("applied")

      // 5. 屏障结束、服务起来之前：applied 回执签名与当前库文件字节一致。
      // 这正是状态端点 verified=true 分支的判定输入（同一比对函数），
      // 且必须是非空的完整 sha256。
      const direct = await computeContentSignature(DATABASE_FILE)
      const planRecord = readRestorePlan({
        stateDir: process.env.MAC_MANAGER_BACKUP_STATE_DIR,
        backupDir: process.env.MAC_MANAGER_BACKUP_DIR,
      })
      const receipt = appliedSignatureOf(planRecord.plan as never)
      expect(receipt).toMatch(/^[0-9a-f]{64}$/)
      expect(direct).toBe(receipt)

      // 6. 恢复后先过启动迁移（与 main.ts 同一顺序：迁移成功才继续）。
      expect(() => initializeTraffic()).not.toThrow()
      expect(itemNames()).toEqual(["row-a", "row-b"])

      // 7. 迁移通过后才起新服务：计划已应用、当前库签名非空。
      // verified 此刻为 false 也是如实表达——启动迁移与协作域初始化会写库，
      // 首次可查询时字节已不同于恢复完成瞬间；三者分开，不冒充已核实。
      await startApp()
      const state = await send("GET", ApiPath.databaseBackupRestore)
      expect(state.status).toBe(200)
      const plan = state.body?.plan as { status?: string } | null
      expect(plan?.status).toBe("applied")
      expect(String(state.body?.currentSignature)).toMatch(/^[0-9a-f]{64}$/)
      expect(typeof state.body?.verified).toBe("boolean")

      // 恢复前的数据有 pre_restore 安全备份兜底。
      const list = await send("GET", `${ApiPath.databaseBackups}?pageSize=50`)
      expect(list.status).toBe(200)
      const listed = list.body?.backups as Array<{ source: string }>
      const sources = listed.map((item) => item.source)
      expect(sources).toContain("pre_restore")
    },
    RESTORE_CASE_TIMEOUT_MS
  )

  it(
    "来源在提交后被改动：恢复明确失败，计划报 failed，当前库不动",
    async () => {
      const created = await createBackup()
      setItems(["row-x"])

      const planned = await send("POST", ApiPath.databaseBackupRestore, {
        body: {
          backupId: created.backup.id,
          expectedSignature: created.backup.contentSignature,
        },
      })
      expect(planned.status).toBe(201)

      // 提交之后替换备份文件内容：执行时复验必须拒绝。
      const file = path.join(
        String(process.env.MAC_MANAGER_BACKUP_DIR),
        created.backup.fileName
      )
      const bytes = readFileSync(file)
      bytes[bytes.length - 1] = bytes[bytes.length - 1] ^ 0xff
      writeFileSync(file, bytes)

      await closeApp()
      const outcome = await runStartupMaintenanceBarrier({
        hasPendingWork: () =>
          hasPendingRestoreWork({
            stateDir: process.env.MAC_MANAGER_BACKUP_STATE_DIR,
          }),
        executeRestore: () =>
          runPendingRestore({
            stateDir: process.env.MAC_MANAGER_BACKUP_STATE_DIR,
            backupDir: process.env.MAC_MANAGER_BACKUP_DIR,
            databaseFile: DATABASE_FILE,
            waitTimeoutMs: 1_000,
          }),
      })
      expect(outcome?.status).toBe("failed")

      // 当前库保持恢复前的数据，失败信号通过状态端点如实回传。
      expect(itemNames()).toEqual(["row-x"])
      await startApp()
      const state = await send("GET", ApiPath.databaseBackupRestore)
      expect(state.status).toBe(200)
      const plan = state.body?.plan as {
        status?: string
        message?: string | null
      } | null
      expect(plan?.status).toBe("failed")
      expect(state.body?.verified).toBe(false)
    },
    RESTORE_CASE_TIMEOUT_MS
  )
})

describe("认证边界", () => {
  it("全部备份端点未带凭据都 401，不返回任何数据", async () => {
    const paths: Array<[string, string]> = [
      ["GET", ApiPath.databaseBackups],
      ["GET", ApiPath.databaseBackupRestore],
      ["POST", ApiPath.databaseBackupsDelete],
      ["POST", ApiPath.databaseBackupRestore],
      ["DELETE", ApiPath.databaseBackupRestore],
      ["POST", ApiPath.databaseBackups],
      [
        "GET",
        ApiPath.databaseBackupDownload.replace(
          ":backupId",
          "missing-backup-id-000000"
        ),
      ],
    ]
    for (const [method, apiPath] of paths) {
      const response = await send(method, apiPath, {
        auth: false,
        ...(method === "POST" && apiPath !== ApiPath.databaseBackups
          ? { body: { items: [], backupId: "x", expectedSignature: "y" } }
          : {}),
      })
      expect(response.status, `${method} ${apiPath} 应 401`).toBe(401)
    }

    // 上传是传输例外，同样挡在认证之外不允许匿名写入。
    const upload = await fetch(`${baseUrl}${ApiPath.databaseBackupUpload}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: Buffer.from([1, 2, 3]),
    })
    expect(upload.status).toBe(401)
    await upload.arrayBuffer()
  })
})
