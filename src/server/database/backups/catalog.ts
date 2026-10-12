import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import path from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { DatabaseSync as Database } from "node:sqlite"
import type {
  DatabaseBackup,
  DatabaseBackupIntegritySchema,
  DatabaseBackupSource,
} from "@shared/api-contract"
import type { z } from "zod"
import {
  BACKUP_FILE_MODE,
  type BackupFileIdentity,
  backupFileSize,
  currentFileIdentity,
  isBackupFileName,
  listBackupDirectory,
  manifestFilePath,
  moveFileAside,
  parseBackupFileName,
  readTextFileIfExists,
  sameFileIdentity,
  writeFileAtomic,
} from "./files"

/**
 * 备份清单（catalog）层：清单条目的模型与读写、由条目与磁盘现状推导契约里的
 * 备份对象、以及对备份文件的只读核查（完整性、结构签名、内容签名、概览）。
 *
 * 清单是旁置文件，不写进被备份的数据库：备份期间源库只读，清单也必须能在
 * 源库损坏时独立读出来。完整性不在这里「缓存成 true」：只有身份与清单记录
 * 一致时才敢说可用，文件缺失或发布后被改动一律按不可用报告。
 */

export type DatabaseBackupIntegrity = z.infer<
  typeof DatabaseBackupIntegritySchema
>

export const BACKUP_MANIFEST_VERSION = 1

/** 条目状态：pending 表示已写入清单但还没确认发布完成。 */
export type BackupEntryStatus = "pending" | "published"

export type BackupManifestEntry = {
  id: string
  fileName: string
  createdAt: number
  sizeBytes: number
  source: DatabaseBackupSource
  /** 文件字节的内容签名：核对文件是否被替换。 */
  contentSignature: string
  /** 结构签名：schema 的规范化哈希，恢复前用于核对兼容性。 */
  structureSignature: string
  tableCount: number | null
  rowCount: number | null
  originalFileName: string | null
  status: BackupEntryStatus
  /** 发布时记录的文件身份；之后据此判断文件是否被改动。 */
  identity: BackupFileIdentity | null
}

export type BackupManifest = {
  version: number
  entries: BackupManifestEntry[]
}

export const emptyManifest = (): BackupManifest => ({
  version: BACKUP_MANIFEST_VERSION,
  entries: [],
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const readIdentity = (value: unknown): BackupFileIdentity | null => {
  if (!isRecord(value)) return null
  const { ino, size, mtimeMs } = value
  if (
    typeof ino !== "number" ||
    typeof size !== "number" ||
    typeof mtimeMs !== "number"
  ) {
    return null
  }
  return { ino, size, mtimeMs }
}

const readEntry = (value: unknown): BackupManifestEntry | null => {
  if (!isRecord(value)) return null
  const {
    id,
    fileName,
    createdAt,
    sizeBytes,
    source,
    contentSignature,
    structureSignature,
    tableCount,
    rowCount,
    originalFileName,
    status,
    identity,
  } = value
  if (
    typeof id !== "string" ||
    typeof fileName !== "string" ||
    parseBackupFileName(fileName) === null ||
    typeof createdAt !== "number" ||
    typeof sizeBytes !== "number" ||
    (source !== "manual" && source !== "import" && source !== "pre_restore") ||
    typeof contentSignature !== "string" ||
    typeof structureSignature !== "string" ||
    (status !== "pending" && status !== "published")
  ) {
    return null
  }
  return {
    id,
    fileName,
    createdAt,
    sizeBytes,
    source,
    contentSignature,
    structureSignature,
    tableCount: typeof tableCount === "number" ? tableCount : null,
    rowCount: typeof rowCount === "number" ? rowCount : null,
    originalFileName:
      typeof originalFileName === "string" ? originalFileName : null,
    status,
    identity: readIdentity(identity),
  }
}

/**
 * 读清单。读不懂时把原文件挪到一边留证（不直接删），返回空清单：
 * 已发布的文件不会被删掉，只是暂时没有索引，由核实流程重新接管。
 */
export const loadManifest = (dir: string): BackupManifest => {
  const file = manifestFilePath(dir)
  const text = readTextFileIfExists(file)
  if (text === null) return emptyManifest()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    moveFileAside(file, "unreadable")
    return emptyManifest()
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.entries)) {
    moveFileAside(file, "unreadable")
    return emptyManifest()
  }
  const entries: BackupManifestEntry[] = []
  const seen = new Set<string>()
  for (const item of parsed.entries) {
    const entry = readEntry(item)
    // 同 ID 重复时保留第一条：清单不允许出现两个指向同一 ID 的条目。
    if (!entry || seen.has(entry.id)) continue
    seen.add(entry.id)
    entries.push(entry)
  }
  return { version: BACKUP_MANIFEST_VERSION, entries }
}

export const saveManifest = (dir: string, manifest: BackupManifest): void => {
  writeFileAtomic(
    manifestFilePath(dir),
    `${JSON.stringify({ version: BACKUP_MANIFEST_VERSION, entries: manifest.entries }, null, 2)}\n`,
    BACKUP_FILE_MODE
  )
}

export const findEntry = (
  manifest: BackupManifest,
  id: string
): BackupManifestEntry | null =>
  manifest.entries.find((entry) => entry.id === id) ?? null

/** 按 ID 覆盖写入条目；返回新清单，不改动入参。 */
export const upsertEntry = (
  manifest: BackupManifest,
  entry: BackupManifestEntry
): BackupManifest => ({
  version: BACKUP_MANIFEST_VERSION,
  entries: [...manifest.entries.filter((item) => item.id !== entry.id), entry],
})

export const dropEntry = (
  manifest: BackupManifest,
  id: string
): BackupManifest => ({
  version: BACKUP_MANIFEST_VERSION,
  entries: manifest.entries.filter((item) => item.id !== id),
})

/** 条目按创建时间倒序，同一毫秒时用 ID 兜底，保证顺序稳定。 */
export const sortEntries = (
  entries: BackupManifestEntry[]
): BackupManifestEntry[] =>
  [...entries].sort(
    (left, right) =>
      right.createdAt - left.createdAt || left.id.localeCompare(right.id)
  )

/**
 * 由条目与磁盘现状推导契约里的备份对象。
 *
 * 只有「清单已发布 + 文件身份与记录一致」才报告可用；文件缺失、
 * 尚未发布、发布后被改动都按不可用报告，并给出具体原因。
 */
export const toDatabaseBackup = (
  dir: string,
  entry: BackupManifestEntry
): DatabaseBackup => {
  const file = path.join(dir, entry.fileName)
  const sizeBytes = backupFileSize(file)
  const integrity = deriveIntegrity(entry, currentFileIdentity(file))
  return {
    id: entry.id,
    fileName: entry.fileName,
    createdAt: entry.createdAt,
    sizeBytes: sizeBytes ?? entry.sizeBytes,
    source: entry.source,
    integrity,
    contentSignature: entry.contentSignature,
    tableCount: entry.tableCount,
    rowCount: entry.rowCount,
    originalFileName: entry.originalFileName,
  }
}

const deriveIntegrity = (
  entry: BackupManifestEntry,
  current: BackupFileIdentity | null
): DatabaseBackupIntegrity => {
  if (current === null) {
    return { ok: false, reason: "备份文件不存在" }
  }
  if (entry.status !== "published") {
    return { ok: false, reason: "上次备份没有完成发布" }
  }
  if (entry.identity === null) {
    return { ok: false, reason: "缺少发布时的文件身份记录，尚未核实" }
  }
  if (!sameFileIdentity(entry.identity, current)) {
    return { ok: false, reason: "备份文件在发布后被改动" }
  }
  return { ok: true }
}

/** 结构签名：schema 的规范化文本哈希（不含 sqlite_ 内部表）。 */
export const computeStructureSignature = (database: DatabaseSync): string => {
  const rows = database
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
    )
    .all()
  const text = rows
    .map(
      (row) =>
        `${String(row.type)}:${String(row.name)}:${row.sql === null ? "" : String(row.sql)}`
    )
    .join("\n")
  return createHash("sha256").update(text).digest("hex")
}

/** 内容签名：流式 sha256，GB 级备份也不会整文件读入内存。 */
export const computeContentSignature = async (
  file: string,
  options: { onBytes?: (bytes: number) => void } = {}
): Promise<string> => {
  const hash = createHash("sha256")
  const stream = createReadStream(file, { highWaterMark: 1 << 20 })
  let read = 0
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    hash.update(chunk)
    read += chunk.length
    options.onBytes?.(read)
  }
  return hash.digest("hex")
}

export type BackupContentInspection = {
  integrity: DatabaseBackupIntegrity
  structureSignature: string | null
  tableCount: number | null
}

/**
 * 只读打开备份文件并跑一次完整性校验。
 *
 * 打不开、不是 SQLite、integrity_check 不通过都返回不可用加原因，不抛错：
 * 调用方需要的是「这个文件现在能不能用」的结论，而不是异常。
 */
export const inspectBackupContent = (file: string): BackupContentInspection => {
  let database: DatabaseSync | null = null
  try {
    database = new Database(file, { readOnly: true })
    const rows = database.prepare("PRAGMA integrity_check").all()
    const first = rows[0]
    const verdict =
      first === undefined ? "" : String(first.integrity_check ?? "")
    if (rows.length !== 1 || verdict !== "ok") {
      return {
        integrity: { ok: false, reason: "完整性校验未通过" },
        structureSignature: null,
        tableCount: null,
      }
    }
    const tables = database
      .prepare(
        "SELECT count(*) AS total FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
      )
      .get()
    return {
      integrity: { ok: true },
      structureSignature: computeStructureSignature(database),
      tableCount: tables === undefined ? null : Number(tables.total),
    }
  } catch (error) {
    return {
      integrity: {
        ok: false,
        reason: `无法作为 SQLite 库读取：${describeReason(error)}`,
      },
      structureSignature: null,
      tableCount: null,
    }
  } finally {
    if (database !== null) {
      try {
        database.close()
      } catch {
        // 已经关掉或从未成功打开：这里不再抛错。
      }
    }
  }
}

const describeReason = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 120)
}

export type BackupDirectoryScan = {
  /** 备份目录里名字合法的备份文件（含未在清单里的）。 */
  files: { name: string; sizeBytes: number; symbolicLink: boolean }[]
  /** 我们自己产生的临时文件（`.xxx.tmp`）。 */
  temporaryFiles: string[]
  /** 目录里的符号链接：既不认成备份，也不删除。 */
  symbolicLinks: string[]
}

/** 扫描备份目录：区分备份文件、临时文件与符号链接。 */
export const scanBackupDirectory = (dir: string): BackupDirectoryScan => {
  const scan: BackupDirectoryScan = {
    files: [],
    temporaryFiles: [],
    symbolicLinks: [],
  }
  for (const entry of listBackupDirectory(dir)) {
    if (entry.symbolicLink) {
      scan.symbolicLinks.push(entry.name)
      continue
    }
    if (isBackupFileName(entry.name)) {
      scan.files.push({
        name: entry.name,
        sizeBytes: entry.sizeBytes,
        symbolicLink: false,
      })
      continue
    }
    if (entry.name.startsWith(".") && entry.name.endsWith(".tmp")) {
      scan.temporaryFiles.push(entry.name)
    }
  }
  return scan
}

/** 由文件名造一条清单条目：只用于清单缺失时接管已在目录里的备份。 */
export const entryFromFileName = (options: {
  name: string
  sizeBytes: number
  identity: BackupFileIdentity
  contentSignature: string
  structureSignature: string
  tableCount: number | null
  source: DatabaseBackupSource
}): BackupManifestEntry | null => {
  const parsed = parseBackupFileName(options.name)
  if (!parsed) return null
  return {
    id: parsed.id,
    fileName: options.name,
    createdAt: parsed.createdAt,
    sizeBytes: options.sizeBytes,
    source: options.source,
    contentSignature: options.contentSignature,
    structureSignature: options.structureSignature,
    tableCount: options.tableCount,
    // 全表计数在 GB 级库上是整表扫描，这里不假填 0，如实给 null。
    rowCount: null,
    originalFileName: null,
    status: "published",
    identity: options.identity,
  }
}
