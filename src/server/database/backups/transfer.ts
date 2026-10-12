import { createReadStream, type ReadStream } from "node:fs"
import { open as openFile, rm } from "node:fs/promises"
import { type Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { TaskProgress } from "@shared/api-contract"
import { DATABASE_BACKUP_UPLOAD_MAX_BYTES } from "@shared/api-contract"
import { formatBytes } from "@shared/format"
import { findEntry, loadManifest } from "./catalog"
import {
  assertBackupFileInDirectory,
  backupFilePathOf,
  DatabaseBackupError,
  ensurePrivateDirectory,
  freeBytesAt,
  openVerifiedBackupFile,
  requiredBytesFor,
  resolveBackupDirectory,
  sameFileIdentity,
  tempFilePathFor,
} from "./files"

/**
 * 备份的上传与下载传输层：只搬运字节与已核验的句柄，不做清单与发布决策。
 *
 * 约定：
 * - 上传流式落盘到备份目录内的隐藏临时文件，全程不把文件读进内存；
 *   字节上限取契约的 8 GiB，一次只接收一个文件（数量也在这里校验）。
 * - 接收前按声明长度预检磁盘空间，接收中每跨过 64 MiB 再复核一次；
 *   失败、中断或超时都清理临时文件，不留下半成品。
 * - 下载只按服务端清单里的备份 ID 定位文件：先核对状态与身份，再用
 *   O_NOFOLLOW 的只读句柄建流；流读完或出错时关闭句柄，不长期持有，
 *   也不接受任何由客户端提供的路径。
 */

/** 单次上传的字节上限；取契约常量，测试可注入更小值。 */
export const BACKUP_UPLOAD_MAX_BYTES = DATABASE_BACKUP_UPLOAD_MAX_BYTES
/** 上传总时限：8 GiB 走本机回环也可能是分钟级，按 GB 级文件给 60 分钟。 */
export const BACKUP_UPLOAD_TIMEOUT_MS = 60 * 60 * 1000
/** 接收进度上报与空间复核的采样间隔。 */
const RECEIVE_CHECKPOINT_BYTES = 64 * 1024 * 1024

export type BackupUploadReceived = {
  /** 落在备份目录内的临时文件，导入流程校验并规范化后负责清理。 */
  tempFile: string
  sizeBytes: number
  /** 客户端声明的原始文件名，仅作展示记录，绝不参与路径拼接。 */
  originalFileName: string | null
}

export type ReceiveBackupUploadOptions = {
  /** 请求体字节流。 */
  source: Readable
  /** 本次要接收的文件数量；单次只接受 1 个，多文件直接拒绝。 */
  fileCount?: number
  /** Content-Length，可缺省（chunked）；提供时用于接收前的空间预检。 */
  declaredLength?: number | null
  /** 原始文件名，仅展示用。 */
  originalFileName?: string | null
  backupDir?: string
  report?: (progress: TaskProgress) => void
  /** 可用空间查询，测试可注入以模拟磁盘不足。 */
  freeBytes?: (dir: string) => number
  /** 传输总时限；默认按 GB 级文件给足 60 分钟。 */
  timeoutMs?: number
  /** 字节上限；默认取契约值，测试注入小上限。 */
  maxBytes?: number
}

/** 原始文件名净化：只留最后一个路径段里的可打印字符并限制长度。 */
const sanitizeFileName = (raw: string): string | null => {
  const base = raw.split(/[/\\]/).pop() ?? ""
  const cleaned = Array.from(base)
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join("")
    .trim()
    .slice(0, 200)
  return cleaned.length > 0 ? cleaned : null
}

/** 接收失败按语义归类；原始错误码优先，其余按备份无效处理。 */
const toUploadError = (error: unknown): DatabaseBackupError => {
  if (error instanceof DatabaseBackupError) return error
  const code =
    error instanceof Error && "code" in error ? String(error.code) : ""
  if (code === "ENOSPC") {
    return new DatabaseBackupError(
      "too_large",
      "接收上传时磁盘空间不足，已清理临时文件"
    )
  }
  if (code === "EACCES" || code === "EPERM") {
    return new DatabaseBackupError(
      "backup_invalid",
      "没有权限写入备份目录，已中止这次上传"
    )
  }
  return new DatabaseBackupError(
    "backup_invalid",
    `接收上传失败：${error instanceof Error ? error.message : String(error)}`
  )
}

/**
 * 流式接收一个 SQLite 备份文件。
 *
 * 临时文件名以 `.` 开头并以 `.tmp` 结尾，不会被备份扫描当成正式备份，
 * 目录权限 0700、文件 0600，只有当前用户可读；重启核实会把遗留的清掉。
 */
export const receiveBackupUpload = async (
  options: ReceiveBackupUploadOptions
): Promise<BackupUploadReceived> => {
  const dir = resolveBackupDirectory(options.backupDir)
  ensurePrivateDirectory(dir)

  const fileCount = options.fileCount ?? 1
  if (fileCount !== 1) {
    throw new DatabaseBackupError(
      "backup_invalid",
      `一次只接收一个备份文件，本次声明了 ${fileCount} 个`
    )
  }

  const timeoutMs = options.timeoutMs ?? BACKUP_UPLOAD_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? BACKUP_UPLOAD_MAX_BYTES
  const declared =
    typeof options.declaredLength === "number" && options.declaredLength >= 0
      ? options.declaredLength
      : null
  if (declared !== null && declared > maxBytes) {
    throw new DatabaseBackupError(
      "too_large",
      `上传文件超过 ${formatBytes(maxBytes)} 上限`
    )
  }

  const freeBytes = options.freeBytes ?? freeBytesAt
  if (declared !== null) {
    const needed = requiredBytesFor(declared)
    const available = freeBytes(dir)
    if (available < needed) {
      throw new DatabaseBackupError(
        "too_large",
        `备份目录空间不足：接收需要约 ${formatBytes(needed)}，可用 ${formatBytes(available)}`
      )
    }
  }

  const originalFileName = sanitizeFileName(options.originalFileName ?? "")
  const tempFile = tempFilePathFor(dir, "upload.sqlite3")
  const handle = await openFile(tempFile, "wx", 0o600)
  let bytesWritten = 0
  let nextCheckpoint = RECEIVE_CHECKPOINT_BYTES

  const report = (done: number, total: number | null): void => {
    options.report?.({
      stage: "接收上传文件",
      done,
      total,
      bytesDone: done,
      bytesTotal: total,
      currentTarget: null,
    })
  }
  report(0, declared)

  const deadline = setTimeout(() => {
    options.source.destroy(
      new Error(`上传超过 ${Math.round(timeoutMs / 1000)} 秒，已中止`)
    )
  }, timeoutMs)
  deadline.unref?.()

  try {
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        if (chunk.length > maxBytes - bytesWritten) {
          callback(
            new DatabaseBackupError(
              "too_large",
              `上传文件超过 ${formatBytes(maxBytes)} 上限`
            )
          )
          return
        }
        bytesWritten += chunk.length
        if (bytesWritten >= nextCheckpoint) {
          nextCheckpoint += RECEIVE_CHECKPOINT_BYTES
          // 每跨过 64 MiB 复核一次空间：chunked 请求没有声明长度，这是唯一的预检点。
          const needed = requiredBytesFor(bytesWritten) + bytesWritten
          const available = freeBytes(dir)
          if (available < needed) {
            callback(
              new DatabaseBackupError(
                "too_large",
                `备份目录空间不足：已接收 ${formatBytes(bytesWritten)}，还需约 ${formatBytes(needed - available)}`
              )
            )
            return
          }
          report(bytesWritten, declared)
        }
        callback(null, chunk)
      },
    })
    await pipeline(options.source, limiter, handle.createWriteStream())
  } catch (error) {
    // 失败或中断：临时文件一定清掉，不留半成品。
    await rm(tempFile, { force: true }).catch(() => undefined)
    throw toUploadError(error)
  } finally {
    clearTimeout(deadline)
    await handle.close().catch(() => undefined)
  }

  if (bytesWritten === 0) {
    await rm(tempFile, { force: true }).catch(() => undefined)
    throw new DatabaseBackupError("backup_invalid", "上传内容为空，已拒绝")
  }

  report(bytesWritten, bytesWritten)
  return { tempFile, sizeBytes: bytesWritten, originalFileName }
}

/** 下载响应头：类型固定、长度明确、附件名来自服务端文件名。 */
export type BackupDownloadHeaders = {
  "content-type": "application/octet-stream"
  "content-length": string
  "content-disposition": string
}

export type BackupDownloadHandle = {
  stream: ReadStream
  sizeBytes: number
  /** 服务端清单里的文件名，用于 Content-Disposition。 */
  fileName: string
  headers: BackupDownloadHeaders
}

/**
 * 打开一个备份的下载流。
 *
 * 只接受备份 ID：清单定位文件名（服务端生成、正则约束），已发布且身份
 * 与记录一致才继续；随后用 O_NOFOLLOW 只读句柄建流，autoClose 保证读完
 * 或客户端中断时句柄被释放，不长期持有。
 */
export const openBackupDownload = (options: {
  backupId: string
  backupDir?: string
}): BackupDownloadHandle => {
  const dir = resolveBackupDirectory(options.backupDir)
  const entry = findEntry(loadManifest(dir), options.backupId)
  if (entry === null || entry.status !== "published") {
    throw new DatabaseBackupError("backup_not_found", "备份不存在")
  }
  const file = backupFilePathOf(dir, entry.fileName)
  const current = assertBackupFileInDirectory(dir, file)
  if (entry.identity === null || !sameFileIdentity(entry.identity, current)) {
    throw new DatabaseBackupError(
      "backup_invalid",
      "备份文件在发布后被改动，已拒绝下载"
    )
  }
  const fd = openVerifiedBackupFile(dir, file)
  const stream = createReadStream(file, { fd, autoClose: true })
  return {
    stream,
    sizeBytes: current.size,
    fileName: entry.fileName,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(current.size),
      "content-disposition": `attachment; filename="${entry.fileName}"`,
    },
  }
}
