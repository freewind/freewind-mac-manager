import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { createExecutorRegistry, taskExecutors } from "@server/tasks/executors"
import type { TaskProgress } from "@shared/api-contract"
import { DatabaseBackupCreatedSchema, TASK_KINDS } from "@shared/api-contract"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  DATABASE_BACKUP_CREATE_KIND,
  databaseBackupTaskTarget,
  runDatabaseBackupCreateTask,
} from "./task"

/**
 * 备份任务的用例：载荷校验、进度上报、以及在任务注册表里能按 kind 找到执行器。
 */

let root = ""
let backupDir = ""
let stateDir = ""
let sourceFile = ""

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "mac-manager-backup-task-"))
  backupDir = path.join(root, "backups")
  stateDir = path.join(root, "state")
  sourceFile = path.join(root, "source.sqlite3")
  const database = new DatabaseSync(sourceFile)
  database.exec(
    "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)"
  )
  database.exec("INSERT INTO items (name) VALUES ('a'), ('b')")
  database.close()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const run = (payload: unknown) => {
  const events: TaskProgress[] = []
  return {
    events,
    outcome: runDatabaseBackupCreateTask({
      payload,
      report: (progress) => events.push(progress),
      serviceOptions: { backupDir, stateDir, sourceFile },
    }),
  }
}

describe("备份任务", () => {
  it("在任务注册表里按 kind 找得到执行器", () => {
    expect(DATABASE_BACKUP_CREATE_KIND).toBe(TASK_KINDS.databaseBackupCreate)
    const registry = createExecutorRegistry(taskExecutors)
    expect(registry.get(DATABASE_BACKUP_CREATE_KIND)).not.toBeNull()
  })

  it("所有备份任务共用同一把域级锁，同一时间只允许一个", () => {
    expect(databaseBackupTaskTarget()).toBe("database:backup")
    expect(databaseBackupTaskTarget()).toBe(databaseBackupTaskTarget())
  })

  // 真跑一次原生备份执行器（任务载荷 → 备份 → 进度上报），无法用克隆
  // 构造替代；并行全量下 CPU 与临时盘争抢会把它偶发推过默认 5 秒
  //（任务 23 六轮与本轮实测各一次），单跑约 0.1-4 秒。断言不变，只放宽上限。
  it("执行器按载荷走默认来源，返回新建备份并上报进度", async () => {
    const { outcome, events } = await run({})
    const created = await outcome
    expect(created.message).toMatch(/^已创建备份 snapshots-/)
    expect(created.status).toBe("done")
    expect(created.result.backup.integrity).toEqual({ ok: true })
    expect(created.result.backup.source).toBe("manual")
    // 结果必须能被契约校验通过，避免服务层输出与契约漂移
    expect(DatabaseBackupCreatedSchema.safeParse(created.result).success).toBe(
      true
    )
    expect(events.at(-1)?.stage).toBe("完成")
  }, 30_000)

  it("非法载荷直接拒绝，不打开源库也不写备份目录", async () => {
    await expect(
      runDatabaseBackupCreateTask({
        payload: { source: "import" },
        report: () => undefined,
        serviceOptions: { backupDir, stateDir, sourceFile },
      })
    ).rejects.toThrow("备份任务载荷非法")
  })
})
