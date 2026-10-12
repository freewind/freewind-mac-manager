import { ApiPath } from "@shared/api-path"
import { describe, expect, it } from "vitest"
import { contract } from "../contract"
import {
  canTransitionRestore,
  DATABASE_BACKUP_DELETE_MAX,
  DATABASE_BACKUP_ERROR_CODES,
  DATABASE_BACKUP_PAGE_SIZE_MAX,
  DATABASE_BACKUP_SOURCES,
  DATABASE_RESTORE_STATUSES,
  DatabaseBackupCreatedSchema,
  DatabaseBackupDeleteBodySchema,
  DatabaseBackupDeleteResultSchema,
  DatabaseBackupErrorSchema,
  DatabaseBackupFileNameSchema,
  DatabaseBackupIdSchema,
  DatabaseBackupSchema,
  DatabaseBackupSourceSchema,
  DatabaseBackupsQuerySchema,
  DatabaseBackupsResponseSchema,
  DatabaseRestorePlanBodySchema,
  DatabaseRestorePlanSchema,
  DatabaseRestoreStateSchema,
  DatabaseRestoreStatusSchema,
} from "./database-backups"

const backup = {
  id: "ab12cd",
  fileName: "snapshots-20261012T093405123Z-ab12cd.sqlite3",
  createdAt: 1_793_600_705_123,
  sizeBytes: 4096,
  source: "manual" as const,
  integrity: { ok: true as const },
  contentSignature: "0123456789abcdef0123456789abcdef",
  tableCount: 3,
  rowCount: 42,
  originalFileName: null,
}

const plan = {
  id: "plan-ab12cd",
  backupId: "ab12cd",
  backupFileName: "snapshots-20261012T093405123Z-ab12cd.sqlite3",
  status: "planned" as const,
  createdAt: 1_793_600_705_123,
  updatedAt: 1_793_600_705_123,
  message: "计划已创建，重启服务后生效",
  unknownReason: null,
}

describe("备份 ID 与文件名", () => {
  it("备份 ID 不接受任何路径穿越文本", () => {
    for (const value of ["ab12cd", "abc_def-123", "A1B2C3"]) {
      expect(DatabaseBackupIdSchema.safeParse(value).success).toBe(true)
    }
    for (const value of [
      "../etc/passwd",
      "a/b",
      "..",
      ".",
      "",
      "short",
      "a".repeat(33),
      "id with space",
      "id.with.dot",
      "id\\win",
    ]) {
      expect(DatabaseBackupIdSchema.safeParse(value).success).toBe(false)
    }
  })

  it("文件名必须是带 UTC 毫秒时间戳的固定形态", () => {
    expect(
      DatabaseBackupFileNameSchema.safeParse(
        "snapshots-20261012T093405123Z-ab12cd.sqlite3"
      ).success
    ).toBe(true)
    for (const value of [
      // 缺毫秒
      "snapshots-20261012T093405Z-ab12cd.sqlite3",
      // 缺 Z（不是 UTC 标记）
      "snapshots-20261012T093405123-ab12cd.sqlite3",
      // 日期位数不对
      "snapshots-2026101T093405123Z-ab12cd.sqlite3",
      // 扩展名不对
      "snapshots-20261012T093405123Z-ab12cd.sqlite",
      "snapshots-20261012T093405123Z-ab12cd.sqlite3.bak",
      // 带路径或穿越
      "../snapshots-20261012T093405123Z-ab12cd.sqlite3",
      "backups/snapshots-20261012T093405123Z-ab12cd.sqlite3",
      "snapshots-20261012T093405123Z-../x.sqlite3",
      // 短 ID 太短
      "snapshots-20261012T093405123Z-ab.sqlite3",
    ]) {
      expect(DatabaseBackupFileNameSchema.safeParse(value).success).toBe(false)
    }
  })

  it("时间戳字段是整数毫秒，不接受小数或负数", () => {
    expect(
      DatabaseBackupSchema.safeParse({ ...backup, createdAt: 1.5 }).success
    ).toBe(false)
    expect(
      DatabaseBackupSchema.safeParse({ ...backup, createdAt: -1 }).success
    ).toBe(false)
    expect(
      DatabaseBackupSchema.safeParse({ ...backup, sizeBytes: -1 }).success
    ).toBe(false)
  })
})

describe("备份条目", () => {
  it("只接受三种来源", () => {
    for (const source of DATABASE_BACKUP_SOURCES) {
      expect(DatabaseBackupSourceSchema.safeParse(source).success).toBe(true)
    }
    for (const source of ["auto", "scheduled", "pre-restore", ""]) {
      expect(DatabaseBackupSourceSchema.safeParse(source).success).toBe(false)
    }
  })

  it("不可用时必须说明原因", () => {
    expect(DatabaseBackupSchema.safeParse(backup).success).toBe(true)
    expect(
      DatabaseBackupSchema.safeParse({
        ...backup,
        integrity: { ok: false, reason: "文件被截断" },
      }).success
    ).toBe(true)
    expect(
      DatabaseBackupSchema.safeParse({ ...backup, integrity: { ok: false } })
        .success
    ).toBe(false)
  })

  it("原始文件名只作展示，允许为空且长度受限", () => {
    expect(
      DatabaseBackupSchema.safeParse({
        ...backup,
        source: "import",
        originalFileName: "我的备份.sqlite3",
      }).success
    ).toBe(true)
    expect(
      DatabaseBackupSchema.safeParse({
        ...backup,
        originalFileName: "x".repeat(256),
      }).success
    ).toBe(false)
  })

  it("概览数字未知时用 null，不冒充 0", () => {
    expect(
      DatabaseBackupSchema.safeParse({
        ...backup,
        tableCount: null,
        rowCount: null,
      }).success
    ).toBe(true)
  })
})

describe("备份列表与创建结果", () => {
  it("分页有默认值且页大小有上限", () => {
    expect(DatabaseBackupsQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 50,
    })
    expect(
      DatabaseBackupsQuerySchema.safeParse({
        pageSize: DATABASE_BACKUP_PAGE_SIZE_MAX,
      }).success
    ).toBe(true)
    expect(
      DatabaseBackupsQuerySchema.safeParse({
        pageSize: DATABASE_BACKUP_PAGE_SIZE_MAX + 1,
      }).success
    ).toBe(false)
    expect(DatabaseBackupsQuerySchema.safeParse({ page: 0 }).success).toBe(
      false
    )
    expect(
      DatabaseBackupsQuerySchema.safeParse({ source: "manual" }).success
    ).toBe(true)
    expect(
      DatabaseBackupsQuerySchema.safeParse({ source: "auto" }).success
    ).toBe(false)
  })

  it("列表响应带目录与总占用", () => {
    expect(
      DatabaseBackupsResponseSchema.safeParse({
        backups: [backup],
        page: 1,
        pageSize: 50,
        total: 1,
        directory: "/data/backups",
        totalBytes: 4096,
      }).success
    ).toBe(true)
    expect(
      DatabaseBackupsResponseSchema.safeParse({
        backups: [],
        page: 1,
        pageSize: 50,
        total: 0,
        directory: "",
        totalBytes: 0,
      }).success
    ).toBe(false)
  })

  it("创建结果必须带上已发布的备份", () => {
    expect(
      DatabaseBackupCreatedSchema.safeParse({
        backup,
        message: "备份已生成",
      }).success
    ).toBe(true)
    expect(
      DatabaseBackupCreatedSchema.safeParse({ message: "备份已生成" }).success
    ).toBe(false)
  })
})

describe("批量删除", () => {
  it("上限 100 条，且每条都要带内容签名", () => {
    const item = {
      id: "ab12cd",
      expectedSignature: "0123456789abcdef0123456789abcdef",
    }
    expect(
      DatabaseBackupDeleteBodySchema.safeParse({
        items: Array.from({ length: DATABASE_BACKUP_DELETE_MAX }, () => item),
      }).success
    ).toBe(true)
    expect(
      DatabaseBackupDeleteBodySchema.safeParse({
        items: Array.from(
          { length: DATABASE_BACKUP_DELETE_MAX + 1 },
          () => item
        ),
      }).success
    ).toBe(false)
    expect(
      DatabaseBackupDeleteBodySchema.safeParse({ items: [] }).success
    ).toBe(false)
    expect(
      DatabaseBackupDeleteBodySchema.safeParse({
        items: [{ id: "ab12cd" }],
      }).success
    ).toBe(false)
    expect(
      DatabaseBackupDeleteBodySchema.safeParse({
        items: [{ id: "ab12cd", expectedSignature: "short" }],
      }).success
    ).toBe(false)
  })

  it("结果逐条给出成功与失败", () => {
    expect(
      DatabaseBackupDeleteResultSchema.safeParse({
        deleted: ["ab12cd"],
        failed: [{ id: "cd34ef", message: "文件已被删除" }],
      }).success
    ).toBe(true)
    expect(
      DatabaseBackupDeleteResultSchema.safeParse({
        deleted: ["ab12cd"],
        failed: [{ id: "cd34ef" }],
      }).success
    ).toBe(false)
  })
})

describe("恢复计划与状态", () => {
  it("状态枚举齐全，迁移只允许列表内的变化", () => {
    for (const status of DATABASE_RESTORE_STATUSES) {
      expect(DatabaseRestoreStatusSchema.safeParse(status).success).toBe(true)
    }
    expect(canTransitionRestore("planned", "applying")).toBe(true)
    expect(canTransitionRestore("planned", "cancelled")).toBe(true)
    expect(canTransitionRestore("applying", "applied")).toBe(true)
    expect(canTransitionRestore("applying", "failed")).toBe(true)
    // 计划不能直接跳到「已恢复」：中间必须真的应用过
    expect(canTransitionRestore("planned", "applied")).toBe(false)
    // 终态不再变化
    for (const status of [
      "applied",
      "failed",
      "cancelled",
      "unknown",
    ] as const) {
      for (const target of DATABASE_RESTORE_STATUSES) {
        expect(canTransitionRestore(status, target)).toBe(false)
      }
    }
  })

  it("结果未知必须说明原因，其它状态不允许带原因", () => {
    expect(DatabaseRestorePlanSchema.safeParse(plan).success).toBe(true)
    expect(
      DatabaseRestorePlanSchema.safeParse({
        ...plan,
        status: "unknown",
        unknownReason: null,
      }).success
    ).toBe(false)
    expect(
      DatabaseRestorePlanSchema.safeParse({
        ...plan,
        status: "unknown",
        unknownReason: "服务在应用过程中中断，无法核实",
      }).success
    ).toBe(true)
    expect(
      DatabaseRestorePlanSchema.safeParse({
        ...plan,
        status: "planned",
        unknownReason: "不该出现在这里",
      }).success
    ).toBe(false)
  })

  it("提交计划时备份 ID 与签名都要给全，默认先备份当前库", () => {
    expect(
      DatabaseRestorePlanBodySchema.parse({
        backupId: "ab12cd",
        expectedSignature: "0123456789abcdef0123456789abcdef",
      })
    ).toEqual({
      backupId: "ab12cd",
      expectedSignature: "0123456789abcdef0123456789abcdef",
      backupCurrent: true,
    })
    expect(
      DatabaseRestorePlanBodySchema.safeParse({
        backupId: "ab12cd",
        expectedSignature: "short",
      }).success
    ).toBe(false)
    expect(
      DatabaseRestorePlanBodySchema.safeParse({
        backupId: "../etc/passwd",
        expectedSignature: "0123456789abcdef0123456789abcdef",
      }).success
    ).toBe(false)
  })

  it("计划存在不等于数据库已经恢复", () => {
    expect(
      DatabaseRestoreStateSchema.safeParse({
        plan,
        currentSignature: "0123456789abcdef0123456789abcdef",
        verified: false,
      }).success
    ).toBe(true)
    expect(
      DatabaseRestoreStateSchema.safeParse({
        plan,
        currentSignature: "0123456789abcdef0123456789abcdef",
        verified: true,
      }).success
    ).toBe(true)
    // 没有当前库签名就不能宣称已经核实恢复
    expect(
      DatabaseRestoreStateSchema.safeParse({
        plan,
        currentSignature: null,
        verified: true,
      }).success
    ).toBe(false)
    expect(
      DatabaseRestoreStateSchema.safeParse({
        plan: null,
        currentSignature: null,
        verified: false,
      }).success
    ).toBe(true)
  })
})

describe("错误结构", () => {
  it("业务错误带稳定错误码，401 走公共结构", () => {
    for (const code of DATABASE_BACKUP_ERROR_CODES) {
      expect(
        DatabaseBackupErrorSchema.safeParse({ message: "失败", code }).success
      ).toBe(true)
    }
    expect(
      DatabaseBackupErrorSchema.safeParse({ message: "失败", code: "nope" })
        .success
    ).toBe(false)
    expect(
      DatabaseBackupErrorSchema.safeParse({ message: "失败" }).success
    ).toBe(false)
  })
})

describe("文件传输例外", () => {
  it("上传与下载只在 ApiPath 声明，不混进 JSON 契约", () => {
    expect(ApiPath.databaseBackupUpload).toBe("/api/database/backups/upload")
    expect(ApiPath.databaseBackupDownload).toBe(
      "/api/database/backups/:backupId/download"
    )
    // 只检查备份的这两条路径没混进契约（其他域有 files/uploads 这类正常路径）
    const paths = JSON.stringify(contract)
    expect(paths).not.toContain("/database/backups/upload")
    expect(paths).not.toContain("/database/backups/:backupId/download")
  })
})
