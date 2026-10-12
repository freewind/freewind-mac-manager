import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createBackupValidationRunner,
  probeSqliteFile,
  validateBackupFileSync,
} from "./validation"

/**
 * 上传校验的用例：只用临时目录里的假文件，不碰真实应用库。
 * 覆盖文件形态拒绝（非 SQLite、WAL 冒充、拼接长度、太小）、损坏与外键
 * 不一致、应用必要结构的单独判断，以及有界 runner 的超时与排队。
 */

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-validation-"))
  file = path.join(dir, "candidate.sqlite3")
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 造一个可独立验证的库；withAppTables=false 时不含应用必要表。 */
const makeDatabase = (
  options: { withAppTables?: boolean; wal?: boolean } = {}
): string => {
  const database = new DatabaseSync(file)
  // 小页建库：文件多于一页，损坏测试能只破坏数据页、保留文件头。
  database.exec("PRAGMA page_size = 512")
  if (options.wal === true) database.exec("PRAGMA journal_mode = WAL")
  if (options.withAppTables !== false) {
    database.exec(`
      CREATE TABLE traffic_samples (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL);
      CREATE TABLE traffic_snapshots (id TEXT PRIMARY KEY, saved_at INTEGER NOT NULL);
      CREATE TABLE traffic_snapshot_entries (snapshot_id TEXT NOT NULL);
    `)
  }
  database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)")
  database.exec("INSERT INTO items (name) VALUES ('apple')")
  database.close()
  return file
}

describe("文件形态预检", () => {
  it("合法的自包含 SQLite：通过并给出结构与恢复结论", () => {
    makeDatabase()
    const probe = probeSqliteFile(file)
    expect(probe.ok).toBe(true)
    const result = validateBackupFileSync(file)
    expect(result.ok).toBe(true)
    expect(result.reason).toBeNull()
    expect(result.tableCount).toBe(4)
    expect(result.structureSignature).toHaveLength(64)
    expect(result.restoreBlockedReason).toBeNull()
  })

  it("有效但缺应用必要表：仍合格，但标记为不可恢复并说明原因", () => {
    makeDatabase({ withAppTables: false })
    const result = validateBackupFileSync(file)
    expect(result.ok).toBe(true)
    expect(result.restoreBlockedReason).toContain("缺少应用必要表")
    expect(result.restoreBlockedReason).toContain("traffic_samples")
  })

  it("文本文件：文件头不是 SQLite，拒绝并给出原因", () => {
    writeFileSync(file, Buffer.alloc(1024, 0x41))
    const result = validateBackupFileSync(file)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("文件头不是 SQLite")
  })

  it("WAL 日志文件冒充独立库：识别魔数并拒绝", () => {
    const buffer = Buffer.alloc(1024, 0)
    buffer.writeUInt32LE(0x377f0682, 0)
    writeFileSync(file, buffer)
    const result = validateBackupFileSync(file)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("WAL 日志文件")
  })

  it("WAL 模式库（缺配套 -wal 无法独立验证）：拒绝", () => {
    makeDatabase({ wal: true })
    const probe = probeSqliteFile(file)
    expect(probe.ok).toBe(false)
    if (!probe.ok) expect(probe.reason).toContain("WAL 模式库")
  })

  it("太小与长度不是页整数倍：分别拒绝", () => {
    writeFileSync(file, Buffer.alloc(64, 0x41))
    expect(validateBackupFileSync(file).reason).toContain("文件太小")
    writeFileSync(file, Buffer.alloc(1000, 0x41))
    const result = validateBackupFileSync(file)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("整数倍")
  })

  it("损坏的库：完整性校验拒绝并给出原因", () => {
    makeDatabase()
    // 保留头页，只覆盖第 2 页：结构可读但内容损坏。
    const bytes = readFileSync(file)
    const pageSize = bytes.readUInt16BE(16)
    const start = pageSize
    const end = Math.min(start + pageSize, bytes.length)
    expect(end).toBeGreaterThan(start)
    bytes.fill(0x5a, start, end)
    writeFileSync(file, bytes)
    const result = validateBackupFileSync(file)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("完整性校验未通过")
  })

  it("外键不一致的库：外键校验拒绝并点名涉及的表", () => {
    const database = new DatabaseSync(file)
    database.exec("CREATE TABLE parent (id INTEGER PRIMARY KEY)")
    database.exec(
      "CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id))"
    )
    database.exec("PRAGMA foreign_keys = OFF")
    database.exec("INSERT INTO child (id, parent_id) VALUES (1, 999)")
    database.close()
    const result = validateBackupFileSync(file)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("外键一致性校验未通过")
    expect(result.reason).toContain("child")
  })
})

/**
 * 假 worker：按文件名决定行为，用来验证父进程的超时、排队与协议校验；
 * 真实 worker 的端到端放在最后一个用例里跑。
 */
const FAKE_WORKER = `
let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => { input += chunk })
process.stdin.on("end", () => {
  const job = JSON.parse(input)
  const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n")
  const result = {
    ok: true,
    reason: null,
    sizeBytes: 512,
    tableCount: 3,
    structureSignature: "a".repeat(64),
    restoreBlockedReason: null,
  }
  if (job.file.includes("slow")) {
    setTimeout(() => write({ type: "result", result }), 400)
    return
  }
  if (job.file.includes("garbage")) {
    process.stdout.write("not a message\\n")
    return
  }
  if (job.file.includes("broken")) {
    write({ type: "failed", error: "校验进程内部失败" })
    return
  }
  write({ type: "result", result })
})
`

describe("有界校验 runner", () => {
  let fakeWorkerFile: string

  beforeEach(() => {
    fakeWorkerFile = path.join(dir, "fake-worker.cjs")
    writeFileSync(fakeWorkerFile, FAKE_WORKER)
  })

  const startRunner = (
    options: Parameters<typeof createBackupValidationRunner>[0] = {}
  ) =>
    createBackupValidationRunner({
      command: process.execPath,
      args: [fakeWorkerFile],
      env: { ...process.env },
      ...options,
    })

  it("子进程返回合格结论：原样交付", async () => {
    const runner = startRunner()
    const result = await runner.validate(path.join(dir, "ok.sqlite3"))
    expect(result.ok).toBe(true)
    expect(result.tableCount).toBe(3)
    runner.shutdown()
  })

  it("子进程报告失败：把原因作为错误抛出", async () => {
    const runner = startRunner()
    await expect(
      runner.validate(path.join(dir, "broken.sqlite3"))
    ).rejects.toThrow("校验进程内部失败")
    runner.shutdown()
  })

  it("超过时限：终止子进程并明确报超时", async () => {
    const runner = startRunner({ timeoutMs: 100 })
    await expect(
      runner.validate(path.join(dir, "slow.sqlite3"))
    ).rejects.toThrow(/超过 100 毫秒/)
    runner.shutdown()
  })

  it("排队已满：直接拒绝，不无限排队", async () => {
    const runner = startRunner({
      maxConcurrency: 1,
      queueLimit: 0,
      timeoutMs: 100,
    })
    const first = runner.validate(path.join(dir, "slow.sqlite3"))
    await expect(runner.validate(path.join(dir, "ok.sqlite3"))).rejects.toThrow(
      /排队已满/
    )
    await expect(first).rejects.toThrow(/超过/)
    runner.shutdown()
  })

  it("返回无法识别的消息：按协议错误处理", async () => {
    const runner = startRunner()
    await expect(
      runner.validate(path.join(dir, "garbage.sqlite3"))
    ).rejects.toThrow(/无法识别|不符合约定/)
    runner.shutdown()
  })
})

describe("真实校验子进程", () => {
  it("端到端：真实 worker 校验临时库并返回结论", async () => {
    makeDatabase()
    const runner = createBackupValidationRunner()
    try {
      const result = await runner.validate(file)
      expect(result.ok).toBe(true)
      expect(result.tableCount).toBe(4)
      expect(result.restoreBlockedReason).toBeNull()
    } finally {
      runner.shutdown()
    }
  }, 30_000)
})
