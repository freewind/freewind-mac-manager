import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createExecutorRegistry, taskExecutors } from "@server/tasks/executors"
import type { TaskProgress } from "@shared/api-contract"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ScanResult } from "./scanner"
import { DiskGrowthStore } from "./store"
import {
  DeleteSnapshotsPayloadSchema,
  DISCARD_KIND,
  EntryPathPayloadSchema,
  REVEAL_KIND,
  runDeleteScansTask,
  runScanTask,
  SCAN_KIND,
  TRASH_KIND,
} from "./task"

let dir: string
let databaseFile: string

const scanResult = (overrides: Partial<ScanResult> = {}): ScanResult => ({
  entries: [
    { path: "/root", parent: "", kind: "dir", size: 2048, folded: false },
  ],
  dirCount: 1,
  fileCount: 3,
  foldedCount: 0,
  totalSize: 2048,
  incomplete: false,
  ...overrides,
})

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-scan-task-"))
  databaseFile = path.join(dir, "snapshots.sqlite3")
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("runScanTask", () => {
  it("writes the snapshot and returns its identifier once scanning finishes", async () => {
    const progress: TaskProgress[] = []
    const outcome = await runScanTask({
      root: "/",
      databaseFile,
      scan: async (_config, onProgress) => {
        onProgress({
          files: 1,
          dirs: 1,
          bytes: 1024,
          stage: "统计文件",
          currentTarget: "/root/a.bin",
        })
        return scanResult()
      },
      report: (item) => progress.push(item),
    })

    expect(outcome.incomplete).toBe(false)
    expect(outcome.result).toEqual({
      snapshotId: outcome.result.snapshotId,
      fileCount: 3,
      dirCount: 1,
      totalSize: 2048,
    })
    expect(outcome.message).toContain(`快照 #${outcome.result.snapshotId}`)

    // 真正落库：读端能看到这一份快照
    const store = new DiskGrowthStore(databaseFile)
    try {
      const snapshots = store.listSnapshots()
      expect(snapshots).toHaveLength(1)
      expect(snapshots[0].fileCount).toBe(3)
      expect(snapshots[0].errorCount).toBe(0)
    } finally {
      store.close()
    }

    // 进度：真实文件数 + 最后的写库阶段
    expect(progress[0]).toMatchObject({
      done: 1,
      stage: "统计文件（1 个目录）",
    })
    expect(progress.at(-1)).toMatchObject({
      done: 3,
      bytesDone: 2048,
      stage: "写入快照",
    })
    // 总量未知，不能给一个假的分母
    expect(progress.at(-1)?.total).toBeNull()
  })

  it("reports partial completion when some content could not be read", async () => {
    const outcome = await runScanTask({
      root: "/",
      databaseFile,
      scan: async () => scanResult({ incomplete: true }),
      report: () => undefined,
    })

    expect(outcome.incomplete).toBe(true)
    expect(outcome.message).toContain("部分内容无法读取")
    const store = new DiskGrowthStore(databaseFile)
    try {
      // 不可读这件事要留在快照里，不能被当成完整结果
      expect(store.listSnapshots()[0].errorCount).toBe(1)
    } finally {
      store.close()
    }
  })

  it("fails without writing a snapshot when scanning throws", async () => {
    await expect(
      runScanTask({
        root: "/",
        databaseFile,
        scan: async () => {
          throw new Error("未找到 fd 可执行文件")
        },
        report: () => undefined,
      })
    ).rejects.toThrow("未找到 fd")

    const store = new DiskGrowthStore(databaseFile)
    try {
      expect(store.listSnapshots()).toEqual([])
    } finally {
      store.close()
    }
  })
})

describe("runDeleteScansTask", () => {
  const seedSnapshot = async (): Promise<number> => {
    const outcome = await runScanTask({
      root: "/",
      databaseFile,
      scan: async () => scanResult(),
      report: () => undefined,
    })
    return outcome.result.snapshotId
  }

  it("removes the snapshot together with its entries in one transaction", async () => {
    const snapshotId = await seedSnapshot()
    const store = new DiskGrowthStore(databaseFile)
    try {
      expect(store.listSnapshots()).toHaveLength(1)
    } finally {
      store.close()
    }

    const progress: TaskProgress[] = []
    const outcome = await runDeleteScansTask({
      scanIds: [snapshotId],
      databaseFile,
      report: (item) => progress.push(item),
    })

    expect(outcome.result.removed).toBe(1)
    expect(outcome.message).toContain("已删除 1 份快照")
    // 进度是按真实份数走的
    expect(progress.at(-1)).toMatchObject({ done: 1, total: 1, stage: "完成" })

    const after = new DiskGrowthStore(databaseFile)
    try {
      expect(after.listSnapshots()).toEqual([])
      // 明细不能留下孤儿行
      expect(after.listEntries({ scanId: snapshotId, parent: "" })).toEqual([])
    } finally {
      after.close()
    }
  })

  it("reports zero when the snapshot is already gone instead of pretending success", async () => {
    const outcome = await runDeleteScansTask({
      scanIds: [999_999],
      databaseFile,
      report: () => undefined,
    })
    expect(outcome.result.removed).toBe(0)
    expect(outcome.message).toContain("已不存在")
  })

  it("rejects malformed delete payloads", () => {
    expect(
      DeleteSnapshotsPayloadSchema.safeParse({ scanIds: [] }).success
    ).toBe(false)
    expect(
      DeleteSnapshotsPayloadSchema.safeParse({ scanIds: ["1"] }).success
    ).toBe(false)
  })
})

describe("entry reveal and trash payloads", () => {
  it("accepts only a single path and rejects anything else", () => {
    expect(EntryPathPayloadSchema.safeParse({ path: "/tmp/a" }).success).toBe(
      true
    )
    expect(EntryPathPayloadSchema.safeParse({ path: "" }).success).toBe(false)
    expect(EntryPathPayloadSchema.safeParse({}).success).toBe(false)
    // 不接受命令或参数：外部输入无法指定要执行什么
    expect(
      EntryPathPayloadSchema.safeParse({ path: "/tmp/a", script: "rm -rf /" })
        .success
    ).toBe(true)
  })

  it("rejects a malformed payload before touching the filesystem", async () => {
    const registry = createExecutorRegistry(taskExecutors)
    await expect(
      registry.get(TRASH_KIND)?.run({ path: "" }, { report: () => undefined })
    ).rejects.toThrow("移到废纸篓载荷非法")
    await expect(
      registry.get(REVEAL_KIND)?.run({}, { report: () => undefined })
    ).rejects.toThrow("访达定位载荷非法")
  })

  it("registers both kinds", () => {
    const kinds = createExecutorRegistry(taskExecutors).kinds()
    expect(kinds).toContain(TRASH_KIND)
    expect(kinds).toContain(REVEAL_KIND)
  })
})

describe("executor registry", () => {
  it("registers the scan kind and rejects a payload that is not a scan request", async () => {
    const registry = createExecutorRegistry(taskExecutors)
    const executor = registry.get(SCAN_KIND)
    expect(executor).not.toBeNull()
    expect(registry.kinds()).toContain(SCAN_KIND)
    expect(registry.kinds()).toContain(DISCARD_KIND)
    await expect(
      executor?.run({ module: "/etc/passwd" }, { report: () => undefined })
    ).rejects.toThrow("扫描任务载荷非法")
  })
})
