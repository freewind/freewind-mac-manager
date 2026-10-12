import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import type { Server } from "node:http"
import { request as httpRequest } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * 环境必须在 import 应用之前定好：env.ts 的目录常量在模块加载时固化。
 * 全部指向临时目录，测试不碰真实 data/snapshots.sqlite3 与真实备份目录。
 */
const hoisted = vi.hoisted(() => {
  const base = `${(process.env.TMPDIR ?? "/tmp").replace(/\/+$/, "")}`
  const root = `${base}/mac-backup-handlers-${process.pid}-${Date.now()}`
  process.env.MAC_MANAGER_PASSWORD = "backup-handler-password"
  process.env.MAC_MANAGER_DB_FILE = `${root}/snapshots.sqlite3`
  process.env.MAC_MANAGER_BACKUP_DIR = `${root}/backups`
  process.env.MAC_MANAGER_BACKUP_STATE_DIR = `${root}/state`
  return { root }
})

import { createApp } from "@server/app"
import { TaskStore } from "@server/common/tasks/store"
import {
  TaskHostError,
  type TaskOutcome,
} from "@server/common/tasks/worker-host"
import { computeContentSignature } from "@server/database/backups/catalog"
import {
  submitRestorePlan,
  transitionRestorePlan,
} from "@server/database/backups/restore-plan"
import { createDatabaseBackupService } from "@server/database/backups/service"
import { runDatabaseBackupCreateTask } from "@server/database/backups/task"
import { DATABASE_FILE } from "@server/env"
import { createTaskRuntime, type TaskRuntime } from "@server/tasks/runtime"
import { DATABASE_BACKUP_FILENAME_PATTERN } from "@shared/api-contract"
import { ApiPath } from "@shared/api-path"

/**
 * 备份管理 API 的边界用例：走真实 createApp（认证、校验、挂载全真），
 * 只用临时库与受控执行器。逐条断言状态码语义：200/201/202/400/401/404/
 * 409/413，以及危险动作的后端状态复核。
 */

const TEST_PASSWORD = "backup-handler-password"
let savedPassword: string | undefined

let dir: string
let store: TaskStore | undefined
let runtime: TaskRuntime | undefined
let server: Server | undefined
let baseUrl: string
/** 任务执行模式：complete 同步真做，hang 挂起用于 202/409。 */
let mode: "complete" | "hang"

beforeEach(async () => {
  savedPassword = process.env.MAC_MANAGER_PASSWORD
  process.env.MAC_MANAGER_PASSWORD = TEST_PASSWORD
  rmSync(hoisted.root, { recursive: true, force: true })
  // 目录必须先建：SQLite 不会替你创建父目录。
  mkdirSync(hoisted.root, { recursive: true })
  dir = mkdtempSync(path.join(tmpdir(), "mac-backup-handler-case-"))
  // 临时应用库：应用必要表 + 一张数据表，备份与恢复都围绕它。
  const source = new DatabaseSync(DATABASE_FILE)
  source.exec(`
    CREATE TABLE traffic_samples (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL);
    CREATE TABLE traffic_snapshots (id TEXT PRIMARY KEY, saved_at INTEGER NOT NULL);
    CREATE TABLE traffic_snapshot_entries (snapshot_id TEXT NOT NULL);
    CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  `)
  source.exec("INSERT INTO items (name) VALUES ('row-0'), ('row-1')")
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
})

afterEach(async () => {
  // beforeEach 中途失败时这些对象可能还没建好：清理必须容忍，避免掩盖真因。
  runtime?.runner.shutdown()
  if (server !== undefined) {
    const closing = server
    await new Promise((resolve) => closing.close(resolve))
  }
  store?.close()
  rmSync(dir, { recursive: true, force: true })
  rmSync(hoisted.root, { recursive: true, force: true })
  if (savedPassword === undefined) {
    delete process.env.MAC_MANAGER_PASSWORD
  } else {
    process.env.MAC_MANAGER_PASSWORD = savedPassword
  }
})

const authHeaders = (
  extra: Record<string, string> = {}
): Record<string, string> => ({
  authorization: `Bearer ${TEST_PASSWORD}`,
  ...extra,
})

const get = async (url: string, withAuth = true) => {
  const response = await fetch(`${baseUrl}${url}`, {
    headers: withAuth ? authHeaders() : {},
  })
  return { status: response.status, body: await response.json() }
}

const post = async (
  url: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {}
) => {
  const response = await fetch(`${baseUrl}${url}`, {
    method: "POST",
    headers: authHeaders({
      "content-type": "application/json",
      ...extraHeaders,
    }),
    body: body === undefined ? "{}" : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

const del = async (url: string) => {
  const response = await fetch(`${baseUrl}${url}`, {
    method: "DELETE",
    headers: authHeaders({ "content-type": "application/json" }),
    body: "{}",
  })
  return { status: response.status, body: await response.json() }
}

/** 直接造一份备份（绕过任务，只服务于详情/删除/计划的前置数据）。 */
const makeBackup = async () => {
  const created = await createDatabaseBackupService().create({
    source: "manual",
  })
  return created.backup
}

const requestIdHeaders = (id: string) => ({ "x-task-request-id": id })

describe("备份列表与详情", () => {
  it("未带凭据一律 401", async () => {
    const result = await get(ApiPath.databaseBackups, false)
    expect(result.status).toBe(401)
    expect(typeof result.body.message).toBe("string")
  })

  it("空列表 200：结构完整、不编造数据", async () => {
    const result = await get(ApiPath.databaseBackups)
    expect(result.status).toBe(200)
    expect(result.body.backups).toEqual([])
    expect(result.body.total).toBe(0)
  })

  it("详情 200；不存在的 ID 404 且带稳定错误码", async () => {
    const backup = await makeBackup()
    const found = await get(`${ApiPath.databaseBackups}/${backup.id}`)
    expect(found.status).toBe(200)
    expect(found.body.id).toBe(backup.id)
    expect(found.body.fileName).toMatch(DATABASE_BACKUP_FILENAME_PATTERN)

    const missing = await get(`${ApiPath.databaseBackups}/missing1`)
    expect(missing.status).toBe(404)
    expect(missing.body.code).toBe("backup_not_found")
  })
})

describe("创建备份（任务受理）", () => {
  it("同步完成返回 201 与已发布备份；列表随即可见", async () => {
    const created = await post(
      ApiPath.databaseBackups,
      {},
      requestIdHeaders("req-create-201-0001")
    )
    expect(created.status).toBe(201)
    expect(created.body.backup.fileName).toMatch(
      DATABASE_BACKUP_FILENAME_PATTERN
    )
    const list = await get(ApiPath.databaseBackups)
    expect(list.body.total).toBe(1)
  })

  it("执行未完成返回 202 受理回执；同目标任务在跑时 409", async () => {
    mode = "hang"
    const accepted = await post(
      ApiPath.databaseBackups,
      {},
      requestIdHeaders("req-create-202-0001")
    )
    expect(accepted.status).toBe(202)
    expect(accepted.body.status).toBe("running")
    expect(typeof accepted.body.taskId).toBe("string")

    const conflicted = await post(
      ApiPath.databaseBackups,
      {},
      requestIdHeaders("req-create-202-0002")
    )
    expect(conflicted.status).toBe(409)
    expect(conflicted.body.executionStatus).toBe("not_started")
  })
})

describe("删除备份", () => {
  it("签名匹配 200 并真正删除；签名不匹配 409；不存在的 ID 逐项失败", async () => {
    const backup = await makeBackup()
    // 签名不匹配是逐项失败（其余项照常处理），不是整批 409。
    const wrong = await post(ApiPath.databaseBackupsDelete, {
      items: [{ id: backup.id, expectedSignature: "f".repeat(64) }],
    })
    expect(wrong.status).toBe(200)
    expect(wrong.body.deleted).toEqual([])
    expect(wrong.body.failed[0].message).toMatch(/签名/)
    // 被拒的备份仍然在。
    expect((await get(ApiPath.databaseBackups)).body.total).toBe(1)

    const missing = await post(ApiPath.databaseBackupsDelete, {
      items: [{ id: "missing1", expectedSignature: "a".repeat(64) }],
    })
    expect(missing.status).toBe(200)
    expect(missing.body.deleted).toEqual([])
    expect(missing.body.failed[0].id).toBe("missing1")

    const deleted = await post(ApiPath.databaseBackupsDelete, {
      items: [{ id: backup.id, expectedSignature: backup.contentSignature }],
    })
    expect(deleted.status).toBe(200)
    expect(deleted.body.deleted).toEqual([backup.id])
    const after = await get(`${ApiPath.databaseBackups}/${backup.id}`)
    expect(after.status).toBe(404)
  })

  it("入参不合法 400（契约校验先于业务执行）", async () => {
    const bad = await post(ApiPath.databaseBackupsDelete, {
      items: [{ id: "no-signature" }],
    })
    expect(bad.status).toBe(400)
  })
})

describe("恢复计划", () => {
  it("状态码逐条：404 不存在、409 签名不符、201 创建、409 重复、200 取消、409 不可取消", async () => {
    // 备份不存在 → 404
    const notFound = await post(ApiPath.databaseBackupRestore, {
      backupId: "missing1",
      expectedSignature: "a".repeat(64),
    })
    expect(notFound.status).toBe(404)
    expect(notFound.body.code).toBe("backup_not_found")

    const backup = await makeBackup()
    // 来源签名与实际不符 → 409（危险动作的后端复核，不信任客户端）
    const mismatch = await post(ApiPath.databaseBackupRestore, {
      backupId: backup.id,
      expectedSignature: "f".repeat(64),
    })
    expect(mismatch.status).toBe(409)
    expect(mismatch.body.code).toBe("signature_mismatch")

    // 正常提交 → 201（只代表计划创建，不代表已恢复）
    const planned = await post(ApiPath.databaseBackupRestore, {
      backupId: backup.id,
      expectedSignature: backup.contentSignature,
    })
    expect(planned.status).toBe(201)
    expect(planned.body.status).toBe("planned")
    expect(planned.body.backupId).toBe(backup.id)

    // 已有活动计划再提交 → 409
    const duplicate = await post(ApiPath.databaseBackupRestore, {
      backupId: backup.id,
      expectedSignature: backup.contentSignature,
    })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.code).toBe("restore_plan_pending")

    // 取消 → 200；已取消再取消 → 409（仅 pending 可取消）
    const cancelled = await del(ApiPath.databaseBackupRestore)
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.status).toBe("cancelled")
    const again = await del(ApiPath.databaseBackupRestore)
    expect(again.status).toBe(409)
    expect(again.body.code).toBe("restore_not_cancellable")
  })

  it("恢复状态：无计划 200 且不冒充已恢复；已应用时按签名核实 verified", async () => {
    const empty = await get(ApiPath.databaseBackupRestore)
    expect(empty.status).toBe(200)
    expect(empty.body.plan).toBeNull()
    expect(empty.body.currentSignature).toBeNull()
    expect(empty.body.verified).toBe(false)

    const backup = await makeBackup()
    submitRestorePlan({
      backupId: backup.id,
      expectedSignature: backup.contentSignature,
    })
    const pending = await get(ApiPath.databaseBackupRestore)
    expect(pending.status).toBe(200)
    expect(pending.body.plan.status).toBe("planned")
    // 未应用时不对 GB 级当前库做签名计算：不拿 null 冒充核实结果。
    expect(pending.body.currentSignature).toBeNull()
    expect(pending.body.verified).toBe(false)

    // 模拟恢复完成：把最终库签名写进 applied 回执，接口据此核实。
    const finalSignature = await computeContentSignature(DATABASE_FILE)
    transitionRestorePlan("applying", {
      phase: "switching",
      message: "切换准备（测试模拟）",
    })
    transitionRestorePlan("applied", {
      phase: "completed",
      message: `恢复已完成并核实（finalSignature=${finalSignature}）：测试模拟`,
    })
    const applied = await get(ApiPath.databaseBackupRestore)
    expect(applied.status).toBe(200)
    expect(applied.body.plan.status).toBe("applied")
    expect(applied.body.currentSignature).toBe(finalSignature)
    expect(applied.body.verified).toBe(true)
  })
})

describe("上传导入与下载（传输例外）", () => {
  /** 造一个可导入的合法库字节（fetch 的 BodyInit 在 DOM lib 下要 ArrayBuffer）。 */
  const importableBytes = (): ArrayBuffer => {
    const file = path.join(dir, "import-source.sqlite3")
    const database = new DatabaseSync(file)
    database.exec(`
      CREATE TABLE traffic_samples (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL);
      CREATE TABLE traffic_snapshots (id TEXT PRIMARY KEY, saved_at INTEGER NOT NULL);
      CREATE TABLE traffic_snapshot_entries (snapshot_id TEXT NOT NULL);
      CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    `)
    database.exec("INSERT INTO items (name) VALUES ('imported')")
    database.close()
    const bytes = readFileSync(file)
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
  }

  it("上传 201：纳入备份列表、不改当前库、原始文件名只留文件名段", async () => {
    const response = await fetch(`${baseUrl}${ApiPath.databaseBackupUpload}`, {
      method: "POST",
      headers: authHeaders({
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("../../evil.sqlite3"),
      }),
      body: importableBytes(),
    })
    const body = await response.json()
    expect(response.status).toBe(201)
    expect(body.backup.source).toBe("import")
    expect(body.backup.originalFileName).toBe("evil.sqlite3")
    expect(body.backup.restoreBlockedReason).toBeNull()

    // 导入绝不改当前应用数据库：行数与导入前一致。
    const current = new DatabaseSync(DATABASE_FILE, { readOnly: true })
    const rows = current
      .prepare("SELECT count(*) AS total FROM items")
      .get() as { total: number }
    current.close()
    expect(Number(rows.total)).toBe(2)

    const list = await get(ApiPath.databaseBackups)
    expect(list.body.total).toBe(1)
  })

  it("上传未带凭据 401", async () => {
    const response = await fetch(`${baseUrl}${ApiPath.databaseBackupUpload}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: "whatever",
    })
    expect(response.status).toBe(401)
  })

  it("非 SQLite 内容 400 且带 unsupported_format", async () => {
    const response = await fetch(`${baseUrl}${ApiPath.databaseBackupUpload}`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/octet-stream" }),
      body: Buffer.from("definitely not a sqlite database at all"),
    })
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.code).toBe("unsupported_format")
    const list = await get(ApiPath.databaseBackups)
    expect(list.body.total).toBe(0)
  })

  it("声明超过 8 GiB 上限：413 且不接收任何字节", async () => {
    const url = new URL(`${baseUrl}${ApiPath.databaseBackupUpload}`)
    const result = await new Promise<{ status: number | undefined }>(
      (resolve, reject) => {
        const request = httpRequest(
          {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: "POST",
            headers: {
              ...authHeaders({ "content-type": "application/octet-stream" }),
              "content-length": String(9 * 1024 * 1024 * 1024),
            },
          },
          (res) => {
            res.resume()
            res.on("end", () => resolve({ status: res.statusCode }))
          }
        )
        request.on("error", reject)
        // 只发头不发 body：服务端在读流之前就按声明长度拒绝。
        request.end()
      }
    )
    expect(result.status).toBe(413)
    const list = await get(ApiPath.databaseBackups)
    expect(list.body.total).toBe(0)
  })

  it("下载 200：附件头与字节一致；不存在 404；发布后被改动 400", async () => {
    const backup = await makeBackup()
    const file = path.join(
      process.env.MAC_MANAGER_BACKUP_DIR as string,
      backup.fileName
    )
    const ok = await fetch(
      `${baseUrl}${ApiPath.databaseBackupDownload.replace(":backupId", backup.id)}`,
      { headers: authHeaders() }
    )
    expect(ok.status).toBe(200)
    expect(ok.headers.get("content-type")).toBe("application/octet-stream")
    expect(ok.headers.get("content-disposition")).toBe(
      `attachment; filename="${backup.fileName}"`
    )
    expect(Number(ok.headers.get("content-length"))).toBe(backup.sizeBytes)
    const bytes = Buffer.from(await ok.arrayBuffer())
    expect(bytes.equals(readFileSync(file))).toBe(true)

    const missing = await fetch(
      `${baseUrl}${ApiPath.databaseBackupDownload.replace(":backupId", "missing1")}`,
      { headers: authHeaders() }
    )
    expect(missing.status).toBe(404)

    // 发布后被改动：拒绝下载，不把坏文件交出去。
    const { appendFileSync } = await import("node:fs")
    appendFileSync(file, "tampered")
    const refused = await fetch(
      `${baseUrl}${ApiPath.databaseBackupDownload.replace(":backupId", backup.id)}`,
      { headers: authHeaders() }
    )
    expect(refused.status).toBe(400)
    const refusedBody = await refused.json()
    expect(refusedBody.code).toBe("backup_invalid")
  })
})
