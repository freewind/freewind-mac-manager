import { randomBytes } from "node:crypto"
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statfsSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { DATABASE_BACKUP_DIR, DATABASE_BACKUP_STATE_DIR } from "@server/env"
import {
  DATABASE_BACKUP_FILENAME_PATTERN,
  type DatabaseBackupErrorCode,
  DatabaseBackupIdSchema,
} from "@shared/api-contract"

/**
 * 备份文件与路径层：目录与权限、文件名与唯一 ID、临时文件与原子发布、
 * 文件身份核对、清单与标记文件的读写、可用空间查询。
 *
 * 这一层只接受服务端自己生成的备份 ID 与文件名，绝不把外部输入拼进路径；
 * 涉及已有文件的动作都先拒绝符号链接，再核对真实路径确实落在备份目录内，
 * 打开之后还要再比对一次身份，避免校验与操作之间被换掉目标。
 */

/** 备份域的统一错误：带稳定错误码，供上层映射成 HTTP 状态。 */
export class DatabaseBackupError extends Error {
  readonly code: DatabaseBackupErrorCode

  constructor(code: DatabaseBackupErrorCode, message: string) {
    super(message)
    this.name = "DatabaseBackupError"
    this.code = code
  }
}

/** 备份目录权限：只有当前用户能进（备份里是整库内容）。 */
export const BACKUP_DIR_MODE = 0o700
/** 备份文件权限：只有当前用户能读。 */
export const BACKUP_FILE_MODE = 0o600
/** 清单文件名：固定名字，写成原子替换，不匹配备份文件名正则。 */
export const MANIFEST_FILE_NAME = "manifest.json"
/** 临时文件后缀：隐藏名 + 该后缀，永远不会被当成备份列出。 */
export const TEMP_FILE_SUFFIX = ".tmp"

/** 备份目录：默认取 env，测试注入临时目录。 */
export const resolveBackupDirectory = (dir?: string): string =>
  dir ?? DATABASE_BACKUP_DIR

/** 备份维护状态目录：默认取 env，测试注入临时目录。 */
export const resolveBackupStateDirectory = (dir?: string): string =>
  dir ?? DATABASE_BACKUP_STATE_DIR

/** 建立目录并收紧权限；目录已存在时 mkdir 的 mode 不生效，因此显式 chmod。 */
export const ensurePrivateDirectory = (dir: string): void => {
  mkdirSync(dir, { recursive: true, mode: BACKUP_DIR_MODE })
  const stats = lstatSync(dir)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new DatabaseBackupError(
      "backup_invalid",
      `备份目录不是普通目录，已拒绝：${dir}`
    )
  }
  chmodSync(dir, BACKUP_DIR_MODE)
}

const pad = (value: number, width = 2): string =>
  String(value).padStart(width, "0")

/** UTC 毫秒时间戳片段：20261012T093405123Z，与契约里的文件名正则一致。 */
export const utcTimestamp = (ms: number): string => {
  const date = new Date(ms)
  return [
    pad(date.getUTCFullYear(), 4),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "T",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    pad(date.getUTCMilliseconds(), 3),
    "Z",
  ].join("")
}

export const buildBackupFileName = (createdAt: number, id: string): string =>
  `snapshots-${utcTimestamp(createdAt)}-${id}.sqlite3`

export const isBackupFileName = (name: string): boolean =>
  DATABASE_BACKUP_FILENAME_PATTERN.test(name)

const FILE_NAME_PARTS =
  /^snapshots-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z-([A-Za-z0-9_-]{6,32})\.sqlite3$/

/**
 * 从文件名还原创建时间与 ID；名字不合法时返回 null。
 * 还原后再拼一次做往返比对，日期越界（如 13 月）这类写法会被判为不合法。
 */
export const parseBackupFileName = (
  name: string
): { createdAt: number; id: string } | null => {
  const matched = FILE_NAME_PARTS.exec(name)
  if (!matched) return null
  const [, year, month, day, hour, minute, second, ms, id] = matched
  const createdAt = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(ms)
  )
  if (!Number.isFinite(createdAt)) return null
  if (!DatabaseBackupIdSchema.safeParse(id).success) return null
  if (buildBackupFileName(createdAt, id) !== name) return null
  return { createdAt, id }
}

/** 备份 ID：URL 安全字符集、8 位随机，同毫秒多次备份也不会重名。 */
export const createBackupId = (): string => randomBytes(6).toString("base64url")

/**
 * 分配一个不与现有文件、也不与已登记条目冲突的文件名。
 * 同一毫秒重复备份时换 ID 重生成，因此不会覆盖已有文件。
 */
export const allocateBackupFileName = (options: {
  dir: string
  createdAt: number
  takenIds: ReadonlySet<string>
  createId: () => string
}): { id: string; fileName: string } => {
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = options.createId()
    if (!DatabaseBackupIdSchema.safeParse(id).success) continue
    if (options.takenIds.has(id)) continue
    const fileName = buildBackupFileName(options.createdAt, id)
    if (existsSync(path.join(options.dir, fileName))) continue
    return { id, fileName }
  }
  throw new DatabaseBackupError(
    "backup_invalid",
    "无法生成唯一的备份文件名，请稍后重试"
  )
}

/**
 * 临时文件路径：与正式文件同目录（保证 rename 是同一文件系统内的原子替换），
 * 名字以 `.` 开头且带 .tmp 后缀，不匹配备份文件名正则。
 */
export const tempFilePathFor = (dir: string, fileName: string): string =>
  path.join(
    dir,
    `.${fileName}.${randomBytes(4).toString("hex")}${TEMP_FILE_SUFFIX}`
  )

export const isTemporaryFileName = (name: string): boolean =>
  name.startsWith(".") && name.endsWith(TEMP_FILE_SUFFIX)

export const manifestFilePath = (dir: string): string =>
  path.join(dir, MANIFEST_FILE_NAME)

/** 目录可用字节数（非特权用户真正能用的量）。 */
export const freeBytesAt = (dir: string): number => {
  const stats = statfsSync(dir)
  return stats.bavail * stats.bsize
}

/**
 * 备份需要的空间：与源库同量级，另留 5% 与 16MiB 余量，
 * 覆盖页对齐、清单写入与同目录临时文件的额外开销。
 */
export const requiredBytesFor = (sourceBytes: number): number =>
  Math.ceil(sourceBytes * 1.05) + 16 * 1024 * 1024

/** 文件身份：发布时记下来，之后据此判断文件是否被替换。 */
export type BackupFileIdentity = {
  ino: number
  size: number
  mtimeMs: number
}

const identityOf = (stats: {
  ino: number
  size: number
  mtimeMs: number
}): BackupFileIdentity => ({
  ino: stats.ino,
  size: stats.size,
  mtimeMs: stats.mtimeMs,
})

export const sameFileIdentity = (
  left: BackupFileIdentity,
  right: BackupFileIdentity
): boolean =>
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeMs === right.mtimeMs

/**
 * 备份目录内某个备份文件的绝对路径：文件名必须严格匹配服务端生成的正则，
 * 因此不可能出现分隔符、`..` 或别的目录。
 */
export const backupFilePathOf = (dir: string, fileName: string): string => {
  if (!isBackupFileName(fileName)) {
    throw new DatabaseBackupError(
      "backup_invalid",
      "备份文件名不合法，已拒绝访问"
    )
  }
  const file = path.join(dir, fileName)
  if (path.dirname(file) !== path.resolve(dir)) {
    throw new DatabaseBackupError(
      "backup_invalid",
      "备份文件不在备份目录内，已拒绝访问"
    )
  }
  return file
}

/**
 * 核对目标是备份目录内的普通文件并返回它的身份：
 * 先 lstat（不跟随符号链接），再比对真实路径的父目录就是备份目录本身。
 */
export const assertBackupFileInDirectory = (
  dir: string,
  file: string
): BackupFileIdentity => {
  const stats = lstatSync(file)
  if (stats.isSymbolicLink()) {
    throw new DatabaseBackupError(
      "backup_invalid",
      "备份文件是符号链接，已拒绝"
    )
  }
  if (!stats.isFile()) {
    throw new DatabaseBackupError(
      "backup_invalid",
      "备份路径不是普通文件，已拒绝"
    )
  }
  const realDir = realpathSync(dir)
  if (path.dirname(realpathSync(file)) !== realDir) {
    throw new DatabaseBackupError(
      "backup_invalid",
      "备份文件的真实路径不在备份目录内，已拒绝"
    )
  }
  return identityOf(stats)
}

/**
 * 打开备份文件并在打开之后核对身份：lstat 与 fstat 必须是同一个 inode，
 * 否则说明校验与打开之间文件被换掉，直接拒绝。
 * O_NOFOLLOW 让打开符号链接直接失败，避免跟随到备份目录之外。
 */
export const openVerifiedBackupFile = (dir: string, file: string): number => {
  const before = assertBackupFileInDirectory(dir, file)
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const after = identityOf(fstatSync(fd))
    if (!sameFileIdentity(before, after)) {
      throw new DatabaseBackupError(
        "backup_invalid",
        "备份文件在打开时已发生变化，已拒绝"
      )
    }
    return fd
  } catch (error) {
    closeSync(fd)
    throw error
  }
}

/** 原子写：同目录临时文件 → fsync → rename，正式路径上不会出现半截内容。 */
export const writeFileAtomic = (
  target: string,
  content: string,
  mode: number
): void => {
  const dir = path.dirname(target)
  const temp = tempFilePathFor(dir, path.basename(target))
  try {
    writeFileSync(temp, content, { encoding: "utf8", mode, flag: "wx" })
    const fd = openSync(temp, constants.O_RDONLY)
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temp, target)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

export const readTextFileIfExists = (file: string): string | null => {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return null
  }
}

/** 把读不懂的文件挪到一边留证，不直接删掉（排查时还要看它）。 */
export const moveFileAside = (file: string, tag: string): string | null => {
  if (!existsSync(file)) return null
  const target = `${file}.${tag}-${Date.now()}`
  try {
    renameSync(file, target)
    return target
  } catch {
    return null
  }
}

export const removeFileIfExists = (file: string): void => {
  rmSync(file, { force: true })
}

/**
 * 删除备份文件：删除前再核对一次身份，确保删掉的就是刚才校验过的那个文件。
 * 用的是 unlink（不跟随符号链接），且只删备份目录内的普通文件。
 */
export const removeBackupFile = (
  dir: string,
  file: string,
  expected: BackupFileIdentity
): void => {
  const current = assertBackupFileInDirectory(dir, file)
  if (!sameFileIdentity(current, expected)) {
    throw new DatabaseBackupError(
      "backup_invalid",
      "备份文件在校验后被改动，已停止删除"
    )
  }
  unlinkSync(file)
}

export type BackupDirectoryEntry = {
  name: string
  sizeBytes: number
  identity: BackupFileIdentity
  /** 符号链接一律单独标出：既不当备份，也不参与清理。 */
  symbolicLink: boolean
}

/** 列出目录里的普通文件与符号链接；子目录忽略，读不到的项目跳过。 */
export const listBackupDirectory = (dir: string): BackupDirectoryEntry[] => {
  const entries: BackupDirectoryEntry[] = []
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (!item.isFile() && !item.isSymbolicLink()) continue
    const file = path.join(dir, item.name)
    try {
      const stats = lstatSync(file)
      entries.push({
        name: item.name,
        sizeBytes: stats.size,
        identity: identityOf(stats),
        symbolicLink: stats.isSymbolicLink(),
      })
    } catch {
      // 读不到（竞态删除等）就跳过，下一次核实再看。
    }
  }
  return entries
}

/** 备份文件的大小；不存在时返回 null。 */
export const backupFileSize = (file: string): number | null => {
  try {
    return lstatSync(file).size
  } catch {
    return null
  }
}

/** 现有文件的身份（lstat，不跟随符号链接）；不存在或读不到时返回 null。 */
export const currentFileIdentity = (
  file: string
): BackupFileIdentity | null => {
  try {
    return identityOf(lstatSync(file))
  } catch {
    return null
  }
}
