import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { Readable } from "node:stream"
import { DATABASE_BACKUP_FILENAME_PATTERN } from "@shared/api-contract"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { loadManifest } from "./catalog"
import { DatabaseBackupError, isTemporaryFileName } from "./files"
import { createDatabaseBackupService } from "./service"
import { openBackupDownload, receiveBackupUpload } from "./transfer"

/**
 * 传输层的用例：只用临时目录。覆盖流式接收的上限、数量、空间、中断与
 * 超时清理，以及下载的句柄核验、响应头与拒绝路径。
 */

const FIXED_NOW = Date.UTC(2026, 9, 12, 9, 34, 5, 123)

let root = ""
let backupDir = ""
let stateDir = ""
let sourceFile = ""

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "mac-manager-transfer-"))
  backupDir = path.join(root, "backups")
  stateDir = path.join(root, "state")
  sourceFile = path.join(root, "source.sqlite3")
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

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

const temporaryFiles = (): string[] =>
  existsSync(backupDir)
    ? readdirSync(backupDir).filter((name) => isTemporaryFileName(name))
    : []

const backupFiles = (): string[] =>
  existsSync(backupDir)
    ? readdirSync(backupDir).filter((name) =>
        DATABASE_BACKUP_FILENAME_PATTERN.test(name)
      )
    : []

const chunks = (...values: string[]): Readable => Readable.from(values)

describe("流式接收上传", () => {
  it("接收成功：字节落盘、大小正确、原始文件名只留文件名段", async () => {
    const payload = Buffer.from("SQLite-bytes-payload")
    const received = await receiveBackupUpload({
      source: Readable.from([payload]),
      declaredLength: payload.length,
      originalFileName: "../../etc/passwd",
      backupDir,
    })
    expect(received.sizeBytes).toBe(payload.length)
    expect(received.originalFileName).toBe("passwd")
    expect(path.basename(received.tempFile).startsWith(".")).toBe(true)
    expect(isTemporaryFileName(path.basename(received.tempFile))).toBe(true)
    expect(readFileSync(received.tempFile)).toEqual(payload)
    expect(path.dirname(received.tempFile)).toBe(backupDir)
  })

  it("超过字节上限：拒绝并清理临时文件", async () => {
    await expect(
      receiveBackupUpload({
        source: chunks("a".repeat(200)),
        backupDir,
        maxBytes: 100,
      })
    ).rejects.toThrow(DatabaseBackupError)
    expect(temporaryFiles()).toHaveLength(0)
  })

  it("声明长度超上限：接收前就拒绝，不创建任何文件", async () => {
    await expect(
      receiveBackupUpload({
        source: chunks("data"),
        declaredLength: 2048,
        backupDir,
        maxBytes: 1024,
      })
    ).rejects.toThrow(/上限/)
    expect(temporaryFiles()).toHaveLength(0)
    expect(backupFiles()).toHaveLength(0)
  })

  it("声明长度下磁盘空间不足：接收前拒绝", async () => {
    await expect(
      receiveBackupUpload({
        source: chunks("data"),
        declaredLength: 4096,
        backupDir,
        freeBytes: () => 1024,
      })
    ).rejects.toThrow(/空间不足/)
    expect(temporaryFiles()).toHaveLength(0)
  })

  it("接收中途磁盘不足：拒绝并清理", async () => {
    let calls = 0
    // 接收前无声明不检查；跨过第一个 64 MiB 检查点时给 0，触发拒绝。
    const freeBytes = (): number => {
      calls += 1
      return calls === 1 ? 0 : Number.MAX_SAFE_INTEGER
    }
    const megabyte = Buffer.alloc(1024 * 1024, 0x61)
    const source = Readable.from(
      (function* () {
        for (let index = 0; index < 65; index++) yield megabyte
      })()
    )
    await expect(
      receiveBackupUpload({ source, backupDir, freeBytes })
    ).rejects.toThrow(/空间不足/)
    expect(calls).toBe(1)
    expect(temporaryFiles()).toHaveLength(0)
  })

  it("空上传：拒绝并清理", async () => {
    await expect(
      receiveBackupUpload({ source: Readable.from([]), backupDir })
    ).rejects.toThrow(/为空/)
    expect(temporaryFiles()).toHaveLength(0)
  })

  it("一次声明多个文件：直接拒绝", async () => {
    await expect(
      receiveBackupUpload({ source: chunks("a"), fileCount: 2, backupDir })
    ).rejects.toThrow(/只接收一个/)
    expect(temporaryFiles()).toHaveLength(0)
  })

  it("传输中途断流：清理临时文件，不报成功", async () => {
    const broken = new Readable({
      read() {
        this.destroy(new Error("受控断流"))
      },
    })
    await expect(
      receiveBackupUpload({ source: broken, backupDir })
    ).rejects.toThrow(/受控断流/)
    expect(temporaryFiles()).toHaveLength(0)
  })

  it("超过时限：中止传输并清理", async () => {
    const never = new Readable({
      read() {
        // 不产出也不结束，靠时限中止。
      },
    })
    await expect(
      receiveBackupUpload({ source: never, backupDir, timeoutMs: 80 })
    ).rejects.toThrow(/上传超过/)
    expect(temporaryFiles()).toHaveLength(0)
  })
})

describe("备份下载", () => {
  const publishOne = async (): Promise<string> => {
    const database = new DatabaseSync(sourceFile)
    database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)")
    database.exec("INSERT INTO items (name) VALUES ('apple')")
    database.close()
    const created = await serviceOf().create({ source: "manual" })
    return created.backup.id
  }

  it("已发布的备份：返回已核验句柄、明确长度与服务端附件名", async () => {
    const id = await publishOne()
    const handle = openBackupDownload({ backupId: id, backupDir })
    const pieces: Buffer[] = []
    for await (const chunk of handle.stream) {
      pieces.push(Buffer.from(chunk))
    }
    const file = loadManifest(backupDir).entries[0]?.fileName ?? ""
    expect(handle.fileName).toBe(file)
    expect(handle.headers["content-type"]).toBe("application/octet-stream")
    expect(handle.headers["content-disposition"]).toBe(
      `attachment; filename="${file}"`
    )
    expect(Number(handle.headers["content-length"])).toBe(handle.sizeBytes)
    expect(Buffer.concat(pieces)).toEqual(
      readFileSync(path.join(backupDir, file))
    )
  })

  it("未知 ID：报备份不存在", () => {
    expect(() => openBackupDownload({ backupId: "nosuch", backupDir })).toThrow(
      DatabaseBackupError
    )
  })

  it("发布后被改动：拒绝下载", async () => {
    const id = await publishOne()
    const entry = loadManifest(backupDir).entries[0]
    appendFileSync(path.join(backupDir, entry.fileName), "tampered")
    expect(() => openBackupDownload({ backupId: id, backupDir })).toThrow(
      /被改动/
    )
  })

  it("文件被换成符号链接：拒绝，不跟随链接读取", async () => {
    const id = await publishOne()
    const entry = loadManifest(backupDir).entries[0]
    const outside = path.join(root, "outside.sqlite3")
    writeFileSync(outside, Buffer.alloc(512, 2))
    rmSync(path.join(backupDir, entry.fileName))
    // 用符号链接顶替备份文件：lstat 检查必须拒绝。
    symlinkSync(outside, path.join(backupDir, entry.fileName))
    expect(() => openBackupDownload({ backupId: id, backupDir })).toThrow(
      DatabaseBackupError
    )
  })
})
