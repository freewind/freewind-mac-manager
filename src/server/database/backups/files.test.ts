import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  allocateBackupFileName,
  assertBackupFileInDirectory,
  BACKUP_DIR_MODE,
  backupFilePathOf,
  buildBackupFileName,
  createBackupId,
  currentFileIdentity,
  DatabaseBackupError,
  ensurePrivateDirectory,
  freeBytesAt,
  isBackupFileName,
  isTemporaryFileName,
  listBackupDirectory,
  manifestFilePath,
  moveFileAside,
  openVerifiedBackupFile,
  parseBackupFileName,
  readTextFileIfExists,
  removeBackupFile,
  removeFileIfExists,
  requiredBytesFor,
  sameFileIdentity,
  tempFilePathFor,
  utcTimestamp,
  writeFileAtomic,
} from "./files"

/**
 * 备份文件层的用例：文件名与时间戳、唯一 ID、路径安全（目录穿越与符号链接）、
 * 文件身份核对、原子写与临时文件识别。
 */

let dir = ""

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-backup-files-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const fileIn = (name: string): string => path.join(dir, name)

describe("备份文件名", () => {
  it("按契约格式生成 UTC 毫秒时间戳文件名，并能原样解析回来", () => {
    const createdAt = Date.UTC(2026, 9, 12, 9, 34, 5, 123)
    expect(utcTimestamp(createdAt)).toBe("20261012T093405123Z")
    const name = buildBackupFileName(createdAt, "ab12cd")
    expect(name).toBe("snapshots-20261012T093405123Z-ab12cd.sqlite3")
    expect(isBackupFileName(name)).toBe(true)
    expect(parseBackupFileName(name)).toEqual({ createdAt, id: "ab12cd" })
  })

  it("拒绝不合法的文件名：形状不对的一律不认", () => {
    for (const name of [
      "snapshots-20261012-ab12cd.sqlite3",
      "snapshots-20261012T093405123Z-.sqlite3",
      "snapshots-20261012T093405123Z-ab12cd.sqlite3.bak",
      "snapshots-20261012T093405123Z-ab12cd.sqlite3/../x.sqlite3",
      "../snapshots-20261012T093405123Z-ab12cd.sqlite3",
      "manifest.json",
    ]) {
      expect(parseBackupFileName(name)).toBeNull()
      expect(isBackupFileName(name)).toBe(false)
    }
  })

  it("形状合法但日期越界的名字解析不出来，因此不会当成备份接管", () => {
    // 契约里的文件名正则只约束位数，日期是否真实由解析这一步兜住
    const name = "snapshots-20261340T093405123Z-ab12cd.sqlite3"
    expect(isBackupFileName(name)).toBe(true)
    expect(parseBackupFileName(name)).toBeNull()
  })

  it("备份 ID 是 URL 安全字符集，同毫秒备份靠 ID 区分", () => {
    const id = createBackupId()
    expect(id).toMatch(/^[A-Za-z0-9_-]{6,32}$/)
    const createdAt = Date.UTC(2026, 9, 12, 9, 34, 5, 123)
    const taken = new Set<string>()
    const created: string[] = []
    for (const next of ["aaaaaa", "bbbbbb", "cccccc"]) {
      const allocated = allocateBackupFileName({
        dir,
        createdAt,
        takenIds: taken,
        createId: () => next,
      })
      taken.add(allocated.id)
      created.push(allocated.fileName)
    }
    // 同一毫秒三次备份：文件名各不相同，没有互相覆盖
    expect(new Set(created).size).toBe(3)
    expect(created[0]).toBe("snapshots-20261012T093405123Z-aaaaaa.sqlite3")
  })

  it("ID 已占用或文件已存在时换一个 ID 重生成", () => {
    const createdAt = Date.UTC(2026, 9, 12, 9, 34, 5, 123)
    const existing = buildBackupFileName(createdAt, "taken1")
    writeFileSync(fileIn(existing), "x")
    const ids = ["taken1", "fresh1"]
    const allocated = allocateBackupFileName({
      dir,
      createdAt,
      takenIds: new Set(["taken1"]),
      createId: () => ids.shift() ?? "fresh1",
    })
    expect(allocated.fileName).toBe(
      "snapshots-20261012T093405123Z-fresh1.sqlite3"
    )
  })
})

describe("路径安全", () => {
  it("只接受备份目录内的合法文件名，穿越写法一律拒绝", () => {
    expect(
      backupFilePathOf(dir, "snapshots-20261012T093405123Z-ab12cd.sqlite3")
    ).toBe(fileIn("snapshots-20261012T093405123Z-ab12cd.sqlite3"))
    for (const name of [
      "../escape.sqlite3",
      "..",
      "/etc/passwd",
      "sub/snapshots-20261012T093405123Z-ab12cd.sqlite3",
      "manifest.json",
    ]) {
      expect(() => backupFilePathOf(dir, name)).toThrow(DatabaseBackupError)
    }
  })

  it("拒绝符号链接：既不认成备份文件，也不跟随它删除目标", () => {
    const outside = fileIn("outside.sqlite3")
    writeFileSync(outside, "real content")
    const link = fileIn("snapshots-20261012T093405123Z-ab12cd.sqlite3")
    symlinkSync(outside, link)

    expect(() => assertBackupFileInDirectory(dir, link)).toThrow(/符号链接/)
    expect(() =>
      removeBackupFile(dir, link, { ino: 0, size: 0, mtimeMs: 0 })
    ).toThrow(/符号链接/)
    // 链接指向的真实文件没有被删掉
    expect(readFileSync(outside, "utf8")).toBe("real content")
    const entries = listBackupDirectory(dir)
    expect(
      entries.find((entry) => entry.name === path.basename(link))?.symbolicLink
    ).toBe(true)
  })

  it("拒绝备份目录之外的文件与符号链接目录", () => {
    const other = mkdtempSync(path.join(tmpdir(), "mac-manager-backup-other-"))
    try {
      const stray = path.join(other, "stray.sqlite3")
      writeFileSync(stray, "x")
      expect(() => assertBackupFileInDirectory(dir, stray)).toThrow(
        /不在备份目录内/
      )

      const linkDir = fileIn("link-dir")
      symlinkSync(other, linkDir)
      expect(() => ensurePrivateDirectory(linkDir)).toThrow(/不是普通目录/)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  it("备份目录建成私有权限，备份文件权限是 0600", () => {
    const target = fileIn("private")
    ensurePrivateDirectory(target)
    expect(lstatSync(target).mode & 0o777).toBe(BACKUP_DIR_MODE)
    const file = fileIn("snapshots-20261012T093405123Z-ab12cd.sqlite3")
    writeFileAtomic(file, "content", 0o600)
    expect(lstatSync(file).mode & 0o777).toBe(0o600)
  })
})

describe("文件身份与打开核对", () => {
  it("身份一致时打开成功，被换掉的文件在删除前被拦下", () => {
    const file = fileIn("snapshots-20261012T093405123Z-ab12cd.sqlite3")
    writeFileSync(file, "first")
    const identity = assertBackupFileInDirectory(dir, file)
    const fd = openVerifiedBackupFile(dir, file)
    expect(fd).toBeGreaterThan(0)

    // 删除前身份被改动：拒绝删除，文件还在
    chmodSync(file, 0o600)
    writeFileSync(file, "second content")
    expect(() => removeBackupFile(dir, file, identity)).toThrow(/被改动/)
    expect(readFileSync(file, "utf8")).toBe("second content")

    // 用改动后的身份删除则成功
    const updated = currentFileIdentity(file)
    expect(updated).not.toBeNull()
    if (updated === null) return
    expect(sameFileIdentity(identity, updated)).toBe(false)
    removeBackupFile(dir, file, updated)
    expect(currentFileIdentity(file)).toBeNull()
  })
})

describe("临时文件与原子写", () => {
  it("临时文件名不匹配备份正则，且能被识别为临时文件", () => {
    const temp = tempFilePathFor(
      dir,
      "snapshots-20261012T093405123Z-ab12cd.sqlite3"
    )
    const name = path.basename(temp)
    expect(isBackupFileName(name)).toBe(false)
    expect(isTemporaryFileName(name)).toBe(true)
    expect(isTemporaryFileName(".manifest.json.abc.tmp")).toBe(true)
  })

  it("原子写先写临时文件再替换，正式路径上不会出现半截内容", () => {
    const target = manifestFilePath(dir)
    writeFileAtomic(target, "first", 0o600)
    writeFileAtomic(target, "second", 0o600)
    expect(readFileSync(target, "utf8")).toBe("second")
    expect(
      readdirSync(dir).filter((name) => isTemporaryFileName(name))
    ).toHaveLength(0)
  })

  it("读不懂的文件挪到一边留证，不直接删除", () => {
    const file = manifestFilePath(dir)
    writeFileSync(file, "{ not json")
    const moved = moveFileAside(file, "unreadable")
    expect(moved).not.toBeNull()
    expect(readTextFileIfExists(file)).toBeNull()
    expect(moved === null ? "" : readFileSync(moved, "utf8")).toBe("{ not json")
  })

  it("目录扫描区分备份文件、临时文件与其它文件", () => {
    writeFileSync(fileIn("snapshots-20261012T093405123Z-ab12cd.sqlite3"), "b")
    writeFileSync(
      fileIn(".snapshots-20261012T093405123Z-ab12cd.sqlite3.9f.tmp"),
      "t"
    )
    writeFileSync(fileIn("notes.txt"), "n")
    mkdirSync(fileIn("subdir"))
    const names = listBackupDirectory(dir)
      .map((entry) => entry.name)
      .sort()
    expect(names).toEqual([
      ".snapshots-20261012T093405123Z-ab12cd.sqlite3.9f.tmp",
      "notes.txt",
      "snapshots-20261012T093405123Z-ab12cd.sqlite3",
    ])
  })
})

describe("磁盘空间", () => {
  it("可用空间按非特权用户口径返回，需求留出余量", () => {
    expect(freeBytesAt(dir)).toBeGreaterThan(0)
    expect(requiredBytesFor(1000)).toBe(
      Math.ceil(1000 * 1.05) + 16 * 1024 * 1024
    )
    expect(requiredBytesFor(0)).toBe(16 * 1024 * 1024)
  })

  it("删不存在的文件是空操作", () => {
    expect(() => removeFileIfExists(fileIn("nope"))).not.toThrow()
  })
})
