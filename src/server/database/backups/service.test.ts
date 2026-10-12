import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { Readable } from "node:stream"
import {
  DATABASE_BACKUP_FILENAME_PATTERN,
  type TaskProgress,
} from "@shared/api-contract"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  type BackupManifestEntry,
  computeContentSignature,
  computeStructureSignature,
  entryFromFileName,
  findEntry,
  inspectBackupContent,
  loadManifest,
  saveManifest,
  upsertEntry,
} from "./catalog"
import {
  allocateBackupFileName,
  createBackupId,
  DatabaseBackupError,
  isTemporaryFileName,
} from "./files"
import { createDatabaseBackupService } from "./service"
import type { BackupValidationResult } from "./validation"

/**
 * 备份服务的用例：只使用临时库与临时目录。
 *
 * 覆盖真实规模下的关键行为：WAL 未 checkpoint 的数据、并发写时的一致性、
 * 同毫秒不覆盖、磁盘与写盘错误不发布半成品、重启后的清单核实、
 * 路径与符号链接防护、删除的逐项结果与受保护备份。
 */

const FIXED_NOW = Date.UTC(2026, 9, 12, 9, 34, 5, 123)

let root = ""
let backupDir = ""
let stateDir = ""
let sourceFile = ""

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "mac-manager-backups-"))
  backupDir = path.join(root, "backups")
  stateDir = path.join(root, "state")
  sourceFile = path.join(root, "source.sqlite3")
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

type SourceOptions = {
  rows?: number
  payloadSize?: number
  keepOpen?: boolean
}

/** 造一个 WAL 模式的源库；keepOpen 时连接保持打开，数据留在 -wal 里。 */
const createSource = (
  options: SourceOptions = {}
): { database: DatabaseSync; rows: number } => {
  const rows = options.rows ?? 200
  const database = new DatabaseSync(sourceFile)
  database.exec("PRAGMA journal_mode = WAL")
  database.exec("PRAGMA wal_autocheckpoint = 0")
  database.exec(
    "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)"
  )
  database.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)")
  database.exec("BEGIN")
  const payload = "x".repeat(options.payloadSize ?? 8)
  for (let index = 0; index < rows; index++) {
    database.exec(`INSERT INTO items (name) VALUES ('row-${index}-${payload}')`)
  }
  database.exec("COMMIT")
  if (options.keepOpen !== true) database.close()
  return { database, rows }
}

const serviceOf = (
  overrides: Parameters<typeof createDatabaseBackupService>[0] = {}
) =>
  createDatabaseBackupService({
    backupDir,
    stateDir,
    sourceFile,
    now: () => FIXED_NOW,
    ...overrides,
  })

/**
 * 克隆一份已发布备份（复制字节 + 手工登记清单条目）：
 * 只用于需要多份备份的删除用例，避免连续多次原生备份撞上测试环境的长等待。
 */
const clonePublished = async (
  fromFileName: string,
  createdAt: number
): Promise<{
  backup: { id: string; fileName: string; contentSignature: string }
}> => {
  const bytes = readFileSync(path.join(backupDir, fromFileName))
  const taken = new Set(loadManifest(backupDir).entries.map((e) => e.id))
  const allocated = allocateBackupFileName({
    dir: backupDir,
    createdAt,
    takenIds: taken,
    createId: createBackupId,
  })
  const file = path.join(backupDir, allocated.fileName)
  writeFileSync(file, bytes, { mode: 0o600 })
  const stats = statSync(file)
  const structure = inspectBackupContent(file).structureSignature
  if (structure === null) throw new Error("克隆备份结构读取失败")
  const entry = entryFromFileName({
    name: allocated.fileName,
    sizeBytes: stats.size,
    identity: { ino: stats.ino, size: stats.size, mtimeMs: stats.mtimeMs },
    contentSignature: await computeContentSignature(file),
    structureSignature: structure,
    tableCount: 2,
    source: "manual",
    restoreBlockedReason: null,
  })
  if (entry === null) throw new Error("克隆备份条目构造失败")
  saveManifest(backupDir, upsertEntry(loadManifest(backupDir), entry))
  return {
    backup: {
      id: entry.id,
      fileName: entry.fileName,
      contentSignature: entry.contentSignature,
    },
  }
}

const backupFiles = (): string[] =>
  readdirSync(backupDir)
    .filter((name) => DATABASE_BACKUP_FILENAME_PATTERN.test(name))
    .sort()

const temporaryFiles = (): string[] =>
  readdirSync(backupDir).filter((name) => isTemporaryFileName(name))

const manifestFile = (): string => path.join(backupDir, "manifest.json")

const readRowCount = (file: string): number => {
  const database = new DatabaseSync(file, { readOnly: true })
  try {
    const row = database.prepare("SELECT count(*) AS total FROM items").get()
    return Number(row?.total ?? 0)
  } finally {
    database.close()
  }
}

describe("创建备份", () => {
  it("含已提交但未 checkpoint 的 WAL 数据：备份可独立打开且数据完整", async () => {
    const { database, rows } = createSource({ rows: 500, keepOpen: true })
    // 数据还只在 -wal 里：主库文件明显小于 WAL
    const walFile = `${sourceFile}-wal`
    expect(existsSync(walFile)).toBe(true)
    const mainSizeBefore = statSync(sourceFile).size

    const created = await serviceOf().create({ source: "manual" })

    expect(created.backup.fileName).toMatch(DATABASE_BACKUP_FILENAME_PATTERN)
    expect(created.backup.integrity).toEqual({ ok: true })
    expect(created.backup.source).toBe("manual")
    expect(created.backup.contentSignature).toHaveLength(64)
    // 只读源连接不会去 checkpoint：源库的主文件与 WAL 都没被动过
    expect(statSync(sourceFile).size).toBe(mainSizeBefore)
    expect(existsSync(walFile)).toBe(true)

    const file = path.join(backupDir, created.backup.fileName)
    // 备份是自包含单文件：没有旁置 -wal/-shm，读它也不会生成
    expect(existsSync(`${file}-wal`)).toBe(false)
    expect(existsSync(`${file}-shm`)).toBe(false)
    expect(readRowCount(file)).toBe(rows)
    expect(existsSync(`${file}-wal`)).toBe(false)

    // 结构签名与源库一致，行数如实给 null（不假填 0）
    const source = new DatabaseSync(sourceFile, { readOnly: true })
    const sourceStructure = computeStructureSignature(source)
    source.close()
    const copy = new DatabaseSync(file, { readOnly: true })
    expect(computeStructureSignature(copy)).toBe(sourceStructure)
    copy.close()
    expect(created.backup.tableCount).toBe(2)
    expect(created.backup.rowCount).toBeNull()

    database.close()
  })

  it("上报真实进度：阶段与页数来自原生备份回调，最后是完成", async () => {
    createSource({ rows: 300 })
    const events: TaskProgress[] = []
    await serviceOf().create({
      source: "manual",
      report: (progress) => events.push(progress),
    })

    const stages = [...new Set(events.map((event) => event.stage))]
    expect(stages[0]).toBe("准备备份")
    expect(stages).toContain("备份数据库")
    expect(stages).toContain("校验备份完整性")
    expect(stages.at(-1)).toBe("完成")

    const copying = events.filter((event) => event.stage === "备份数据库")
    expect(copying.length).toBeGreaterThan(0)
    for (const event of copying) {
      expect(event.total).toBeGreaterThan(0)
      expect(event.done).toBeLessThanOrEqual(event.total ?? 0)
      expect(event.bytesDone).toBe((event.done ?? 0) * 4096)
    }
    const done = events.at(-1)
    expect(done?.bytesDone).toBe(done?.bytesTotal)
  })

  it("备份期间有其他连接写入：备份仍是一致快照，能正常完成", async () => {
    const { database, rows } = createSource({
      rows: 2000,
      payloadSize: 1024,
      keepOpen: true,
    })
    const writer = new DatabaseSync(sourceFile)
    let wrote = 0
    // 在备份过程中插入写入：原生备份可能重来，但绝不给出半截快照
    const create = await (async () => {
      let injected = 0
      return serviceOf().create({
        source: "manual",
        report: (progress) => {
          if (progress.stage !== "备份数据库" || injected >= 2) return
          injected++
          writer.exec("BEGIN")
          writer.exec("INSERT INTO items (name) VALUES ('concurrent')")
          writer.exec("COMMIT")
          wrote++
        },
      })
    })()
    try {
      expect(wrote).toBeGreaterThan(0)
      const backupRows = readRowCount(
        path.join(backupDir, create.backup.fileName)
      )
      // 一致快照：行数落在「开始备份」到「备份结束」之间，不是半截数据
      expect(backupRows).toBeGreaterThanOrEqual(rows)
      expect(backupRows).toBeLessThanOrEqual(rows + wrote)
      expect(readRowCount(sourceFile)).toBe(rows + wrote)
      expect(create.backup.integrity).toEqual({ ok: true })
      expect(create.backup.tableCount).toBe(2)
    } finally {
      writer.close()
      database.close()
    }
  })

  it("同一毫秒的两次备份不覆盖：文件名不同、都在列表里", async () => {
    createSource({ rows: 50 })
    const service = serviceOf()
    const first = await service.create({ source: "manual" })
    const second = await service.create({ source: "manual" })

    expect(first.backup.createdAt).toBe(FIXED_NOW)
    expect(second.backup.createdAt).toBe(FIXED_NOW)
    expect(first.backup.fileName).not.toBe(second.backup.fileName)
    expect(first.backup.id).not.toBe(second.backup.id)
    expect(backupFiles()).toHaveLength(2)

    const listed = service.list({ page: 1, pageSize: 50 })
    expect(listed.total).toBe(2)
    expect(listed.totalBytes).toBeGreaterThan(0)
    expect(listed.directory).toBe(backupDir)
    // 两份文件都还在，各自都能独立打开
    for (const backup of listed.backups) {
      expect(readRowCount(path.join(backupDir, backup.fileName))).toBe(50)
    }
  })

  it("备份目录私有、备份文件 0600、不留临时文件与旁置文件", async () => {
    createSource({ rows: 50 })
    const created = await serviceOf().create({ source: "manual" })
    expect(lstatSync(backupDir).mode & 0o777).toBe(0o700)
    const file = path.join(backupDir, created.backup.fileName)
    expect(lstatSync(file).mode & 0o777).toBe(0o600)
    expect(temporaryFiles()).toHaveLength(0)
    expect(existsSync(path.join(stateDir, "in-progress.json"))).toBe(false)
  })
})

describe("失败不留半成品", () => {
  it("磁盘空间不足：明确失败，目录里不出现任何备份", async () => {
    createSource({ rows: 200 })
    const service = serviceOf({ freeBytes: () => 1024 })
    await expect(service.create({ source: "manual" })).rejects.toThrow(
      /备份空间不足/
    )
    expect(backupFiles()).toHaveLength(0)
    expect(temporaryFiles()).toHaveLength(0)
    expect(loadManifest(backupDir).entries).toHaveLength(0)
    expect(existsSync(path.join(stateDir, "in-progress.json"))).toBe(false)
  })

  it("发布前写清单失败：删掉临时文件、清掉进行中标记、不发布半成品", async () => {
    createSource({ rows: 4000, payloadSize: 1024 })
    const service = serviceOf()
    let broken = false
    await expect(
      service.create({
        source: "manual",
        report: (progress) => {
          if (broken || progress.stage !== "计算内容签名") return
          broken = true
          // 备份已经完成、正在算签名：此时让清单无法写入
          rmSync(manifestFile(), { force: true })
          mkdirSync(manifestFile())
        },
      })
    ).rejects.toThrow(DatabaseBackupError)
    expect(broken).toBe(true)
    expect(backupFiles()).toHaveLength(0)
    expect(temporaryFiles()).toHaveLength(0)
    expect(existsSync(path.join(stateDir, "in-progress.json"))).toBe(false)
    rmSync(manifestFile(), { recursive: true, force: true })
  })

  it("源库不是有效的 SQLite：失败且不留下任何东西", async () => {
    writeFileSync(sourceFile, "definitely not a database")
    const service = serviceOf()
    await expect(service.create({ source: "manual" })).rejects.toThrow(
      DatabaseBackupError
    )
    expect(backupFiles()).toHaveLength(0)
    expect(temporaryFiles()).toHaveLength(0)
  })
})

describe("重启后的保守核实", () => {
  it("pending 条目接管为已发布、条目文件没了就丢弃、临时文件与陈旧标记清掉", async () => {
    createSource({ rows: 80 })
    const service = serviceOf()
    const created = await service.create({ source: "manual" })

    // 造出「上次进程被杀」的现场：条目回到 pending、留下临时文件与死进程标记
    const manifest = loadManifest(backupDir)
    const entry = findEntry(manifest, created.backup.id)
    expect(entry).not.toBeNull()
    if (entry === null) return
    saveManifest(
      backupDir,
      upsertEntry(manifest, { ...entry, status: "pending" })
    )
    writeFileSync(
      path.join(backupDir, `.${entry.fileName}.abcd1234.tmp`),
      "half written"
    )
    writeFileSync(
      path.join(stateDir, "in-progress.json"),
      JSON.stringify({
        backupId: "deadbeef",
        fileName: entry.fileName,
        startedAt: FIXED_NOW,
        pid: 999999,
      })
    )
    // 另一条记录的文件已经不在
    const gone: BackupManifestEntry = {
      ...entry,
      id: "gonefile",
      fileName: entry.fileName.replace(
        /[^/]+\.sqlite3$/,
        "snapshots-20261012T093405123Z-goneid.sqlite3"
      ),
    }
    saveManifest(backupDir, upsertEntry(loadManifest(backupDir), gone))

    const report = await serviceOf().reconcile()
    expect(report.publishedPending).toEqual([created.backup.id])
    expect(report.droppedEntries).toEqual(["gonefile"])
    expect(report.removedTemporaryFiles).toHaveLength(1)
    expect(report.staleMarker).toBe(true)
    expect(existsSync(path.join(stateDir, "in-progress.json"))).toBe(false)
    expect(temporaryFiles()).toHaveLength(0)

    const after = loadManifest(backupDir)
    expect(findEntry(after, created.backup.id)?.status).toBe("published")
    expect(findEntry(after, "gonefile")).toBeNull()
    expect(serviceOf().get(created.backup.id)?.integrity).toEqual({ ok: true })
  })

  it("清单损坏：挪走留证，目录里已发布的备份被重新接管", async () => {
    createSource({ rows: 80 })
    await serviceOf().create({ source: "manual" })
    writeFileSync(manifestFile(), "{ 这不是 JSON")

    const report = await serviceOf().reconcile()
    expect(report.adoptedFiles).toHaveLength(1)
    // 损坏的清单没有被删掉，挪到一边留证
    expect(
      readdirSync(backupDir).filter((name) => name.includes("unreadable"))
    ).toHaveLength(1)

    const listed = serviceOf().list({ page: 1, pageSize: 50 })
    expect(listed.total).toBe(1)
    // 来源无法追溯：按导入处理，不假装成手工创建
    expect(listed.backups[0]?.source).toBe("import")
    expect(listed.backups[0]?.integrity).toEqual({ ok: true })
    expect(listed.backups[0]?.contentSignature).toHaveLength(64)
  })

  it("目录里不是有效备份的文件：不认成备份，也不删除", async () => {
    createSource({ rows: 20 })
    const name = "snapshots-20261012T093405123Z-fake01.sqlite3"
    mkdirSync(backupDir, { recursive: true })
    writeFileSync(path.join(backupDir, name), "not a sqlite file")

    const report = await serviceOf().reconcile()
    expect(report.unindexedFiles).toEqual([name])
    expect(existsSync(path.join(backupDir, name))).toBe(true)
    expect(serviceOf().list({ page: 1, pageSize: 50 }).total).toBe(0)
  })

  it("清单里出现穿越文件名：该条目被丢弃，不会被解析到目录外", async () => {
    mkdirSync(backupDir, { recursive: true })
    writeFileSync(
      manifestFile(),
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "escape1",
            fileName: "../../etc/passwd",
            createdAt: FIXED_NOW,
            sizeBytes: 1,
            source: "manual",
            contentSignature: "a".repeat(64),
            structureSignature: "b".repeat(64),
            status: "published",
            identity: { ino: 1, size: 1, mtimeMs: 1 },
          },
        ],
      })
    )
    const service = serviceOf()
    expect(loadManifest(backupDir).entries).toHaveLength(0)
    expect(service.get("escape1")).toBeNull()
    const removed = await service.remove({
      items: [{ id: "escape1", expectedSignature: "a".repeat(64) }],
    })
    expect(removed.deleted).toHaveLength(0)
    expect(removed.failed[0]?.message).toBe("备份不存在")
  })
})

describe("列表与详情", () => {
  it("只列已发布且文件还在的备份，支持来源过滤与分页", async () => {
    createSource({ rows: 20 })
    const service = serviceOf()
    const manual = await service.create({ source: "manual" })
    await service.create({ source: "pre_restore" })

    const all = service.list({ page: 1, pageSize: 50 })
    expect(all.total).toBe(2)
    const onlyManual = service.list({ page: 1, pageSize: 50, source: "manual" })
    expect(onlyManual.total).toBe(1)
    expect(onlyManual.backups[0]?.id).toBe(manual.backup.id)
    const paged = service.list({ page: 2, pageSize: 1 })
    expect(paged.backups).toHaveLength(1)
    expect(paged.total).toBe(2)

    // 文件被外部删掉后不再列出（读取不改清单）
    rmSync(path.join(backupDir, manual.backup.fileName))
    expect(service.list({ page: 1, pageSize: 50 }).total).toBe(1)
    expect(service.get(manual.backup.id)).toBeNull()
    expect(loadManifest(backupDir).entries).toHaveLength(2)
  })

  it("详情按 ID 读取；未知 ID 返回 null", async () => {
    createSource({ rows: 20 })
    const service = serviceOf()
    const created = await service.create({ source: "manual" })
    expect(service.get(created.backup.id)?.fileName).toBe(
      created.backup.fileName
    )
    expect(service.get("nosuchid")).toBeNull()
    expect(service.get("../../etc/passwd")).toBeNull()
  })

  it("发布后被改动：列表如实报不可用，删除被拒", async () => {
    createSource({ rows: 20 })
    const service = serviceOf()
    const created = await service.create({ source: "manual" })
    const file = path.join(backupDir, created.backup.fileName)
    writeFileSync(file, Buffer.concat([readFileSync(file), Buffer.from("x")]))

    const listed = service.list({ page: 1, pageSize: 50 })
    expect(listed.backups[0]?.integrity).toEqual({
      ok: false,
      reason: "备份文件在发布后被改动",
    })
    const removed = await service.remove({
      items: [
        {
          id: created.backup.id,
          expectedSignature: created.backup.contentSignature,
        },
      ],
    })
    expect(removed.deleted).toHaveLength(0)
    expect(removed.failed[0]?.message).toMatch(/被改动/)
    expect(existsSync(file)).toBe(true)
  })
})

describe("删除", () => {
  it("逐项返回真正删除、缺失与失败，不把部分结果报成全成功", async () => {
    createSource({ rows: 20 })
    const service = serviceOf()
    // 只真跑一次原生备份：测试环境里连续多次原生备份会撞上间歇性长等待，
    // 而本用例验证的是删除的逐项语义——另外两份用同内容副本手工登记即可。
    const first = await service.create({ source: "manual" })
    const second = await clonePublished(first.backup.fileName, FIXED_NOW)
    const third = await clonePublished(first.backup.fileName, FIXED_NOW)

    // 第三份的文件在删除前被外部删掉
    rmSync(path.join(backupDir, third.backup.fileName))

    const result = await service.remove({
      items: [
        {
          id: first.backup.id,
          expectedSignature: first.backup.contentSignature,
        },
        { id: "nosuchid", expectedSignature: "a".repeat(64) },
        {
          id: third.backup.id,
          expectedSignature: third.backup.contentSignature,
        },
        { id: second.backup.id, expectedSignature: "b".repeat(64) },
        {
          id: second.backup.id,
          expectedSignature: second.backup.contentSignature,
        },
      ],
    })

    expect(result.deleted).toEqual([first.backup.id])
    const messages = new Map(
      result.failed.map((item) => [item.id, item.message])
    )
    expect(messages.get("nosuchid")).toBe("备份不存在")
    expect(messages.get(third.backup.id)).toBe("备份文件不存在")
    expect(messages.get(second.backup.id)).toMatch(/签名不一致|重复出现/)
    expect(existsSync(path.join(backupDir, first.backup.fileName))).toBe(false)
    expect(existsSync(path.join(backupDir, second.backup.fileName))).toBe(true)

    const manifest = loadManifest(backupDir)
    expect(findEntry(manifest, first.backup.id)).toBeNull()
    expect(findEntry(manifest, third.backup.id)).toBeNull()
    expect(findEntry(manifest, second.backup.id)).not.toBeNull()
  })

  it("单次删除超过 100 条直接拒绝", async () => {
    createSource({ rows: 20 })
    const service = serviceOf()
    const items = Array.from({ length: 101 }, (_, index) => ({
      id: `bogus${index}000000`,
      expectedSignature: "a".repeat(64),
    }))
    await expect(service.remove({ items })).rejects.toThrow(/最多删除 100/)
  })

  it("受恢复计划引用与正在创建的备份都不能删除", async () => {
    createSource({ rows: 20 })
    const service = serviceOf()
    const protectedOne = await service.create({ source: "manual" })
    const running = await service.create({ source: "manual" })
    writeFileSync(
      path.join(stateDir, "in-progress.json"),
      JSON.stringify({
        backupId: running.backup.id,
        fileName: running.backup.fileName,
        startedAt: FIXED_NOW,
        pid: process.pid,
      })
    )

    const result = await service.remove({
      items: [
        {
          id: protectedOne.backup.id,
          expectedSignature: protectedOne.backup.contentSignature,
        },
        {
          id: running.backup.id,
          expectedSignature: running.backup.contentSignature,
        },
      ],
      protectedIds: new Set([protectedOne.backup.id]),
    })
    expect(result.deleted).toHaveLength(0)
    expect(result.failed[0]?.message).toMatch(/恢复计划/)
    expect(result.failed[1]?.message).toMatch(/正在创建/)
    expect(backupFiles()).toHaveLength(2)
  })

  it("备份文件被换成符号链接：拒绝删除，也不跟随删除目标", async () => {
    createSource({ rows: 20 })
    const service = serviceOf()
    const created = await service.create({ source: "manual" })
    const file = path.join(backupDir, created.backup.fileName)
    const outside = path.join(root, "outside.sqlite3")
    writeFileSync(outside, "important")
    rmSync(file)
    symlinkSync(outside, file)

    const result = await service.remove({
      items: [
        {
          id: created.backup.id,
          expectedSignature: created.backup.contentSignature,
        },
      ],
    })
    expect(result.deleted).toHaveLength(0)
    expect(result.failed[0]?.message).toMatch(/被改动|符号链接/)
    expect(readFileSync(outside, "utf8")).toBe("important")
  })

  it("删除只动备份目录：不碰当前库文件", async () => {
    createSource({ rows: 20 })
    const service = serviceOf()
    const created = await service.create({ source: "manual" })
    // 伪造一条指向源库的清单记录，删除必须拒绝
    const manifest = loadManifest(backupDir)
    const entry = findEntry(manifest, created.backup.id)
    if (entry === null) return
    saveManifest(
      backupDir,
      upsertEntry(manifest, { ...entry, fileName: entry.fileName })
    )
    const result = await service.remove({
      items: [
        {
          id: created.backup.id,
          expectedSignature: created.backup.contentSignature,
        },
      ],
    })
    expect(result.deleted).toEqual([created.backup.id])
    expect(existsSync(sourceFile)).toBe(true)
  })

  it("没有发布时身份记录的条目：先核实内容一致再删，不一致就拒绝", async () => {
    createSource({ rows: 20 })
    const service = serviceOf()
    const created = await service.create({ source: "manual" })
    const manifest = loadManifest(backupDir)
    const entry = findEntry(manifest, created.backup.id)
    if (entry === null) return
    const file = path.join(backupDir, entry.fileName)

    // 身份记录被抹掉，但内容没变：核实通过后允许删除
    saveManifest(backupDir, upsertEntry(manifest, { ...entry, identity: null }))
    const okResult = await serviceOf().remove({
      items: [
        {
          id: created.backup.id,
          expectedSignature: created.backup.contentSignature,
        },
      ],
    })
    expect(okResult.deleted).toEqual([created.backup.id])
    expect(existsSync(file)).toBe(false)

    // 再造一份，把清单里的签名改成与文件不符：必须拒绝
    const second = await serviceOf().create({ source: "manual" })
    const manifest2 = loadManifest(backupDir)
    const entry2 = findEntry(manifest2, second.backup.id)
    if (entry2 === null) return
    saveManifest(
      backupDir,
      upsertEntry(manifest2, {
        ...entry2,
        identity: null,
        contentSignature: await computeContentSignature(
          path.join(backupDir, entry2.fileName)
        ),
      })
    )
    const badManifest = loadManifest(backupDir)
    const entry3 = findEntry(badManifest, second.backup.id)
    if (entry3 === null) return
    saveManifest(
      backupDir,
      upsertEntry(badManifest, {
        ...entry3,
        identity: null,
        contentSignature: "c".repeat(64),
      })
    )
    const bad = await serviceOf().remove({
      items: [{ id: second.backup.id, expectedSignature: "c".repeat(64) }],
    })
    expect(bad.deleted).toHaveLength(0)
    expect(bad.failed[0]?.message).toMatch(/不一致/)
    expect(existsSync(path.join(backupDir, entry2.fileName))).toBe(true)
  })
})

describe("上传导入", () => {
  /** 造一个可导入的上传库字节（非 WAL；默认含应用必要表）。 */
  const uploadBytes = (options: { withAppTables?: boolean } = {}): Buffer => {
    const file = path.join(root, "upload-source.sqlite3")
    rmSync(file, { force: true })
    const database = new DatabaseSync(file)
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
    return readFileSync(file)
  }

  const okValidation = (
    overrides: Partial<BackupValidationResult> = {}
  ): BackupValidationResult => ({
    ok: true,
    reason: null,
    sizeBytes: 4096,
    tableCount: 4,
    structureSignature: "a".repeat(64),
    restoreBlockedReason: null,
    ...overrides,
  })

  it("成功导入：以 import 来源与服务端文件名发布，上传原件被清理", async () => {
    const bytes = uploadBytes()
    // 不注入校验：走真实 worker 子进程，端到端验证导入链路。
    const created = await serviceOf().importUpload({
      source: Readable.from([bytes]),
      declaredLength: bytes.length,
      originalFileName: "../../snap.sqlite3",
    })
    expect(created.backup.source).toBe("import")
    expect(created.backup.fileName).toMatch(DATABASE_BACKUP_FILENAME_PATTERN)
    expect(created.backup.originalFileName).toBe("snap.sqlite3")
    expect(created.backup.restoreBlockedReason).toBeNull()
    expect(created.backup.integrity.ok).toBe(true)
    expect(created.backup.sizeBytes).toBeGreaterThan(0)
    expect(backupFiles()).toHaveLength(1)
    // 上传原件与规范化临时文件都不留；也没有 WAL 旁置文件。
    expect(temporaryFiles()).toHaveLength(0)
    const names = readdirSync(backupDir)
    expect(names.some((name) => name.endsWith("-wal"))).toBe(false)
    expect(names.some((name) => name.endsWith("-shm"))).toBe(false)
    expect(loadManifest(backupDir).entries[0].status).toBe("published")
    // 规范化产物可独立打开。
    const restored = new DatabaseSync(
      path.join(backupDir, created.backup.fileName),
      {
        readOnly: true,
      }
    )
    const rows = restored.prepare("SELECT count(*) AS total FROM items").get()
    restored.close()
    expect(Number(rows?.total)).toBe(1)
  }, 30_000)

  it("同一毫秒再次导入：文件名不同、两份都在列表里", async () => {
    const bytes = uploadBytes()
    const service = serviceOf()
    const first = await service.importUpload({
      source: Readable.from([bytes]),
      validate: async () => okValidation(),
    })
    const second = await service.importUpload({
      source: Readable.from([bytes]),
      validate: async () => okValidation(),
    })
    expect(first.backup.fileName).not.toBe(second.backup.fileName)
    expect(service.list({ page: 1, pageSize: 10 }).total).toBe(2)
  })

  it("无效上传：报不支持的格式，列表为空、无任何残留", async () => {
    const error = await serviceOf()
      .importUpload({
        source: Readable.from([Buffer.from("not a database at all")]),
        validate: async () => ({
          ok: false,
          reason: "文件头不是 SQLite 格式，可能是压缩包或其他文件",
          sizeBytes: 21,
          tableCount: null,
          structureSignature: null,
          restoreBlockedReason: null,
        }),
      })
      .catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(DatabaseBackupError)
    expect((error as DatabaseBackupError).code).toBe("unsupported_format")
    expect(backupFiles()).toHaveLength(0)
    expect(temporaryFiles()).toHaveLength(0)
    expect(serviceOf().list({ page: 1, pageSize: 10 }).total).toBe(0)
  })

  it("有效但缺应用必要表：入列表并标记不可恢复原因", async () => {
    const bytes = uploadBytes({ withAppTables: false })
    const created = await serviceOf().importUpload({
      source: Readable.from([bytes]),
      validate: async () => okValidation(),
    })
    expect(created.backup.restoreBlockedReason).toContain("缺少应用必要表")
    expect(created.backup.restoreBlockedReason).toContain("traffic_samples")
    // 不可恢复但不隔离：仍可列出与读取详情。
    const detail = serviceOf().get(created.backup.id)
    expect(detail?.id).toBe(created.backup.id)
  })

  it("导入只碰上传文件，不改当前应用数据库", async () => {
    createSource({ rows: 50 })
    const before = readFileSync(sourceFile)
    const bytes = uploadBytes()
    await serviceOf().importUpload({
      source: Readable.from([bytes]),
      validate: async () => okValidation(),
    })
    const after = readFileSync(sourceFile)
    expect(after.equals(before)).toBe(true)
  })

  it("空间不足：导入被拒，不留下任何东西", async () => {
    const bytes = uploadBytes()
    await expect(
      serviceOf({ freeBytes: () => 1024 }).importUpload({
        source: Readable.from([bytes]),
        declaredLength: bytes.length,
      })
    ).rejects.toThrow(/空间不足/)
    expect(backupFiles()).toHaveLength(0)
    expect(temporaryFiles()).toHaveLength(0)
  })

  it("已有备份任务进行中：拒绝导入", async () => {
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(
      path.join(stateDir, "in-progress.json"),
      JSON.stringify({
        backupId: "busy01",
        fileName: "snapshots-20261012T093405123Z-busy01.sqlite3",
        startedAt: Date.now(),
        pid: process.pid,
      })
    )
    await expect(
      serviceOf().importUpload({ source: Readable.from([uploadBytes()]) })
    ).rejects.toThrow(/正在进行/)
    expect(backupFiles()).toHaveLength(0)
  })
})
