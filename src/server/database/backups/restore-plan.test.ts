import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { Readable } from "node:stream"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DatabaseBackupError, isTemporaryFileName } from "./files"
import {
  cancelRestorePlan,
  canTransitionRestorePlan,
  hasPendingRestoreWork,
  readRestorePlan,
  referencedBackupIds,
  submitRestorePlan,
  toContractRestorePlan,
  transitionRestorePlan,
  verifyRestoreSource,
} from "./restore-plan"
import { createDatabaseBackupService } from "./service"
import type { BackupValidationResult } from "./validation"

/**
 * 恢复计划用例：只用临时目录。覆盖 requestId 去重、活动计划冲突、
 * 来源核验（签名、身份、应用结构）、仅 pending 可取消、状态机与阶段回执、
 * 被引用备份保护、计划文件损坏的如实报告。
 */

const FIXED_NOW = Date.UTC(2026, 9, 12, 9, 34, 5, 123)

let root = ""
let backupDir = ""
let stateDir = ""
let sourceFile = ""

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "mac-restore-plan-"))
  backupDir = path.join(root, "backups")
  stateDir = path.join(root, "state")
  sourceFile = path.join(root, "current.sqlite3")
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const context = () => ({ stateDir, backupDir })

const service = () =>
  createDatabaseBackupService({
    backupDir,
    stateDir,
    sourceFile,
    now: () => FIXED_NOW,
  })

/** 造当前库（含应用必要表）并返回行数。 */
const createSource = (rows = 3): number => {
  const database = new DatabaseSync(sourceFile)
  database.exec("PRAGMA journal_mode = WAL")
  database.exec(`
    CREATE TABLE traffic_samples (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL);
    CREATE TABLE traffic_snapshots (id TEXT PRIMARY KEY, saved_at INTEGER NOT NULL);
    CREATE TABLE traffic_snapshot_entries (snapshot_id TEXT NOT NULL);
    CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  `)
  for (let index = 0; index < rows; index++) {
    database.exec(`INSERT INTO items (name) VALUES ('row-${index}')`)
  }
  database.close()
  return rows
}

const makeBackup = async () => {
  createSource()
  return service().create({ source: "manual" })
}

describe("提交恢复计划", () => {
  it("提交成功：pending、文件名与身份齐全，对外映射 planned", async () => {
    const created = await makeBackup()
    const plan = submitRestorePlan(
      {
        backupId: created.backup.id,
        expectedSignature: created.backup.contentSignature,
        requestId: "req-1",
      },
      context()
    )
    expect(plan.status).toBe("pending")
    expect(plan.backupFileName).toBe(created.backup.fileName)
    expect(plan.backupIdentity).not.toBeNull()
    expect(plan.phase).toBe("accepted")
    const contract = toContractRestorePlan(plan)
    expect(contract.status).toBe("planned")
    expect(contract.message).toBe("计划已创建，等待重启生效")
    expect(hasPendingRestoreWork(context())).toBe(true)
  })

  it("同一 requestId 重复提交：幂等返回同一计划", async () => {
    const created = await makeBackup()
    const input = {
      backupId: created.backup.id,
      expectedSignature: created.backup.contentSignature,
      requestId: "req-same",
    }
    const first = submitRestorePlan(input, context())
    const second = submitRestorePlan(input, context())
    expect(second.id).toBe(first.id)
    expect(readRestorePlan(context()).plan?.id).toBe(first.id)
  })

  it("已有等待中的计划：不同请求再提交被拒", async () => {
    const created = await makeBackup()
    submitRestorePlan(
      {
        backupId: created.backup.id,
        expectedSignature: created.backup.contentSignature,
        requestId: "req-a",
      },
      context()
    )
    expect(() =>
      submitRestorePlan(
        {
          backupId: created.backup.id,
          expectedSignature: created.backup.contentSignature,
          requestId: "req-b",
        },
        context()
      )
    ).toThrow(DatabaseBackupError)
    try {
      submitRestorePlan(
        {
          backupId: created.backup.id,
          expectedSignature: created.backup.contentSignature,
          requestId: "req-c",
        },
        context()
      )
    } catch (error) {
      expect((error as DatabaseBackupError).code).toBe("restore_plan_pending")
    }
  })

  it("签名不匹配：拒绝且不留下计划", async () => {
    const created = await makeBackup()
    expect(() =>
      submitRestorePlan(
        {
          backupId: created.backup.id,
          expectedSignature: "f".repeat(64),
        },
        context()
      )
    ).toThrow(DatabaseBackupError)
    expect(readRestorePlan(context()).plan).toBeNull()
    expect(existsSync(path.join(stateDir, "restore-plan.json"))).toBe(false)
  })

  it("备份不存在：拒绝且不留下计划", () => {
    expect(() =>
      submitRestorePlan(
        { backupId: "nope99", expectedSignature: "a".repeat(64) },
        context()
      )
    ).toThrow(/不存在/)
    expect(readRestorePlan(context()).plan).toBeNull()
  })

  it("来源被替换（文件改动）：执行前核验也能拒绝", async () => {
    const created = await makeBackup()
    const file = path.join(backupDir, created.backup.fileName)
    appendFileSync(file, "tampered")
    const result = verifyRestoreSource({
      backupId: created.backup.id,
      expectedSignature: created.backup.contentSignature,
      context: context(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/改动|签名/)
  })

  it("缺应用必要表的来源：按不兼容拒绝", async () => {
    createSource()
    // 造一个没有流量表的外来库并导入成备份。
    const foreignFile = path.join(root, "foreign.sqlite3")
    const foreign = new DatabaseSync(foreignFile)
    foreign.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)")
    foreign.exec("INSERT INTO notes (body) VALUES ('hello')")
    foreign.close()
    const bytes = readFileSync(foreignFile)
    const imported = await service().importUpload({
      source: Readable.from([bytes]),
      validate: async (): Promise<BackupValidationResult> => ({
        ok: true,
        reason: null,
        sizeBytes: bytes.length,
        tableCount: 1,
        structureSignature: "a".repeat(64),
        restoreBlockedReason: null,
      }),
    })
    expect(() =>
      submitRestorePlan(
        {
          backupId: imported.backup.id,
          expectedSignature: imported.backup.contentSignature,
        },
        context()
      )
    ).toThrow(DatabaseBackupError)
    expect(readRestorePlan(context()).plan).toBeNull()
    // 详情里仍能看到不可恢复的原因（列表与删除不受影响）。
    expect(imported.backup.restoreBlockedReason).toContain("缺少应用必要表")
  })

  it("同一请求的计划已终态：重复提交按状态冲突拒绝", async () => {
    const created = await makeBackup()
    const input = {
      backupId: created.backup.id,
      expectedSignature: created.backup.contentSignature,
      requestId: "req-plan-finish-01",
    }
    const plan = submitRestorePlan(input, context())
    cancelRestorePlan(context())
    // 同一请求重发：计划已 cancelled，不能被变成一份新计划。
    try {
      submitRestorePlan(input, context())
      expect.unreachable("已终态的计划不应允许重复提交")
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseBackupError)
      expect((error as DatabaseBackupError).code).toBe("restore_plan_pending")
    }
    expect(readRestorePlan(context()).plan?.status).toBe("cancelled")
    expect(plan.status).toBe("pending")
  })

  it("取消：仅 pending 可取消，无计划与已取消都拒绝", async () => {
    expect(() => cancelRestorePlan(context())).toThrow(/没有待取消/)
    const created = await makeBackup()
    submitRestorePlan(
      {
        backupId: created.backup.id,
        expectedSignature: created.backup.contentSignature,
      },
      context()
    )
    const cancelled = cancelRestorePlan(context())
    expect(cancelled.status).toBe("cancelled")
    expect(cancelled.message).toContain("取消")
    // 已终态不可取消：错误码是 restore_not_cancellable（HTTP 409）。
    try {
      cancelRestorePlan(context())
      expect.unreachable("已取消的计划不应允许再次取消")
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseBackupError)
      expect((error as DatabaseBackupError).code).toBe(
        "restore_not_cancellable"
      )
      expect((error as DatabaseBackupError).message).toMatch(/仅等待执行/)
    }
    expect(hasPendingRestoreWork(context())).toBe(false)
  })
})

describe("状态机与回执", () => {
  it("合法迁移与终态冻结", () => {
    expect(canTransitionRestorePlan("planning", "pending")).toBe(true)
    expect(canTransitionRestorePlan("pending", "applying")).toBe(true)
    expect(canTransitionRestorePlan("applying", "applied")).toBe(true)
    expect(canTransitionRestorePlan("applied", "applying")).toBe(false)
    expect(canTransitionRestorePlan("cancelled", "pending")).toBe(false)
    expect(canTransitionRestorePlan("failed", "applying")).toBe(false)
    expect(canTransitionRestorePlan("unknown", "applied")).toBe(false)
  })

  it("阶段回执按序追加，记录恢复进度", async () => {
    const created = await makeBackup()
    submitRestorePlan(
      {
        backupId: created.backup.id,
        expectedSignature: created.backup.contentSignature,
      },
      context()
    )
    transitionRestorePlan("applying", {
      phase: "safety_backup",
      message: "安全备份进行中",
      context: context(),
    })
    const plan = readRestorePlan(context()).plan
    expect(plan?.status).toBe("applying")
    expect(plan?.phase).toBe("safety_backup")
    expect(plan?.receipts.map((item) => item.phase)).toContain("safety_backup")
    expect(plan?.receipts[0]?.phase).toBe("accepted")
  })

  it("非法迁移直接拒绝，不改状态", async () => {
    const created = await makeBackup()
    submitRestorePlan(
      {
        backupId: created.backup.id,
        expectedSignature: created.backup.contentSignature,
      },
      context()
    )
    cancelRestorePlan(context())
    expect(() =>
      transitionRestorePlan("applying", {
        message: "想把已取消的计划改回执行",
        context: context(),
      })
    ).toThrow(/不能从/)
    expect(readRestorePlan(context()).plan?.status).toBe("cancelled")
  })

  it("unknown 必须带原因", async () => {
    const created = await makeBackup()
    submitRestorePlan(
      {
        backupId: created.backup.id,
        expectedSignature: created.backup.contentSignature,
      },
      context()
    )
    const plan = transitionRestorePlan("unknown", {
      message: "无法核实",
      context: context(),
    })
    expect(plan.status).toBe("unknown")
    expect(plan.unknownReason).not.toBeNull()
    expect(toContractRestorePlan(plan).status).toBe("unknown")
  })
})

describe("计划文件健壮性", () => {
  it("损坏的计划文件：挪走留证并如实报告，不当成没有计划", () => {
    mkdirSync(stateDir, { recursive: true })
    const file = path.join(stateDir, "restore-plan.json")
    writeFileSync(file, "not-json{{{")
    const read = readRestorePlan(context())
    expect(read.corrupt).toBe(true)
    expect(read.plan).toBeNull()
    expect(existsSync(file)).toBe(false)
    const aside = readdirSync(stateDir).filter((name) =>
      name.includes("corrupt")
    )
    expect(aside).toHaveLength(1)
    // 计划损坏也要在启动时介入报告，不能静默当成无计划。
    expect(hasPendingRestoreWork(context())).toBe(true)
  })

  it("被引用的备份在活动计划期间不可用作删除", async () => {
    const created = await makeBackup()
    expect(referencedBackupIds(context()).size).toBe(0)
    submitRestorePlan(
      {
        backupId: created.backup.id,
        expectedSignature: created.backup.contentSignature,
      },
      context()
    )
    expect(referencedBackupIds(context())).toEqual(new Set([created.backup.id]))
    cancelRestorePlan(context())
    expect(referencedBackupIds(context()).size).toBe(0)
  })

  it("临时库与备份目录里没有计划残留的临时文件", async () => {
    const created = await makeBackup()
    submitRestorePlan(
      {
        backupId: created.backup.id,
        expectedSignature: created.backup.contentSignature,
      },
      context()
    )
    const leftovers = readdirSync(backupDir).filter((name) =>
      isTemporaryFileName(name)
    )
    expect(leftovers).toHaveLength(0)
  })
})
