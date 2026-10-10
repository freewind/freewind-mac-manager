import { randomUUID } from "node:crypto"
import type { Dirent, ReadStream } from "node:fs"
import {
  constants,
  createReadStream,
  createWriteStream,
  existsSync,
} from "node:fs"
import {
  copyFile,
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import type { Readable } from "node:stream"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { FILE_ROOT } from "@server/env"
import type {
  DirectoryResponse,
  FileContentResponse,
  FileEntry,
} from "@shared/api-contract"
import { describeError } from "@shared/format"

/** 上传中的临时后缀；带此后缀的文件不出现在目录列表里。 */
const UPLOAD_PART_SUFFIX = ".uploading.part"
const OPERATION_PART_SUFFIX = ".operation.part"

/** 在线编辑的大小上限，超过直接拒绝，避免把大文件读进内存。 */
const MAX_EDITABLE_BYTES = 2 * 1024 * 1024
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024

/** 批量 stat 的批大小，避免一次对大目录的每个条目同时发起请求。 */
const STAT_BATCH_SIZE = 64

/** 递归操作的并发上限：既能压满磁盘，又不会同时打开过多文件。 */
const TRANSFER_CONCURRENCY = 8

/**
 * 文件操作进度：done/bytesDone 只统计确实处理完的条目，
 * total 只在能便宜拿到时才给（复制、移动不预先全盘统计，因此为 null）。
 */
export type FileOperationProgress = {
  done: number
  total: number | null
  bytesDone: number
  stage: string
  currentTarget: string | null
}

/** 逐项结果：允许部分完成，不把「删了一半」笼统说成失败。 */
export type FileBatchOutcome = {
  completed: string[]
  failed: { path: string; message: string }[]
  /** 已产生部分副作用且不能回滚为原状的条目。 */
  partial?: { path: string; destination?: string; message: string }[]
  skipped: string[]
  /** 实际写入的字节数；删除不适用时为 null。 */
  bytes: number | null
}

type OperationIo = {
  rename?: typeof rename
  copyFile?: typeof copyFile
  link?: typeof link
  remove?: typeof rm
}

type OperationOptions = {
  report?: (progress: FileOperationProgress) => void
  /** 测试注入真实环境难以稳定复现的跨卷与文件系统竞争。 */
  io?: OperationIo
}

type TransferContext = {
  active: number
  waiters: (() => void)[]
  failed: boolean
  error: unknown
}

type TransferCounter = { done: number; bytes: number }
type DeleteCounter = TransferCounter & { removed: number }

const noop = (): void => undefined

const createTransferContext = (): TransferContext => ({
  active: 0,
  waiters: [],
  failed: false,
  error: null,
})

const releaseTransferSlot = (context: TransferContext): void => {
  const next = context.waiters.shift()
  if (next) {
    next()
    return
  }
  context.active -= 1
}

const acquireTransferSlot = async (context: TransferContext): Promise<void> => {
  if (context.failed) throw context.error
  if (context.active < TRANSFER_CONCURRENCY) {
    context.active += 1
    return
  }
  await new Promise<void>((resolve) => context.waiters.push(resolve))
  if (context.failed) {
    releaseTransferSlot(context)
    throw context.error
  }
}

const runTransferLimited = async <T>(
  context: TransferContext,
  run: () => Promise<T>
): Promise<T> => {
  await acquireTransferSlot(context)
  try {
    if (context.failed) throw context.error
    return await run()
  } catch (error) {
    if (!context.failed) {
      context.failed = true
      context.error = error
    }
    throw error
  } finally {
    releaseTransferSlot(context)
  }
}

/** 所有递归层级共享同一并发池；失败后停止派发并等待已启动工作结束。 */
const mapWithLimit = async <T>(
  items: T[],
  run: (item: T) => Promise<void>,
  context: TransferContext
): Promise<void> => {
  let cursor = 0
  const workers = Array.from(
    { length: Math.min(TRANSFER_CONCURRENCY, items.length) },
    async () => {
      for (;;) {
        if (context.failed) return
        const index = cursor
        cursor += 1
        if (index >= items.length) return
        try {
          await run(items[index])
        } catch (error) {
          if (!context.failed) {
            context.failed = true
            context.error = error
          }
          return
        }
      }
    }
  )
  await Promise.all(workers)
  if (context.failed) throw context.error
}

const TEXT_EXTENSIONS = new Set([
  "bash",
  "c",
  "cc",
  "cfg",
  "conf",
  "cpp",
  "css",
  "csv",
  "env",
  "gitignore",
  "go",
  "gradle",
  "groovy",
  "h",
  "hpp",
  "htm",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "kts",
  "less",
  "log",
  "md",
  "mjs",
  "php",
  "properties",
  "py",
  "rs",
  "scss",
  "sh",
  "sql",
  "svg",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
])

const TEXT_NAMES = new Set([
  "dockerfile",
  "makefile",
  "gemfile",
  "rakefile",
  ".gitignore",
  ".editorconfig",
  ".env",
])

/** 常见的 Node errno，转成给用户看的中文。 */
const ERRNO_MESSAGES: Record<string, string> = {
  EACCES: "没有访问权限",
  EBUSY: "目标正被占用",
  EEXIST: "同名条目已存在",
  EISDIR: "目标是目录",
  EMFILE: "打开的文件过多，请稍后重试",
  ENOENT: "路径不存在",
  ENOSPC: "磁盘空间不足",
  ENOTDIR: "路径中有部分不是目录",
  ENOTEMPTY: "目录非空",
  EPERM: "没有权限",
  EROFS: "只读文件系统",
}

/** 把 Node 的 errno 转成可读中文；业务层自己抛的错误信息原样保留。 */
export const describeFileError = (error: unknown): string => {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code !== undefined && ERRNO_MESSAGES[code] !== undefined) {
    return ERRNO_MESSAGES[code]
  }
  return describeError(error)
}

export const isEditableTextFile = (fileName: string): boolean => {
  const lower = fileName.toLowerCase()
  if (TEXT_NAMES.has(lower)) return true
  const dot = lower.lastIndexOf(".")
  if (dot <= 0) return false
  return TEXT_EXTENSIONS.has(lower.slice(dot + 1))
}

const assertSafeName = (name: string): string => {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    throw new Error(`非法名称：${name}`)
  }
  return name
}

/** 所有入参路径都必须落在 FILE_ROOT 之内，防目录穿越。 */
export const resolvePath = (input: string): string => {
  const target = path.resolve(input || FILE_ROOT)
  const relative = path.relative(FILE_ROOT, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`非法路径：${input}`)
  }
  return target
}

const assertWithinRoot = (target: string): void => {
  const relative = path.relative(FILE_ROOT, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("路径通过符号链接越出允许范围")
  }
}

/** 现有目标拒绝符号链接，并确认解析后的真实路径仍在 FILE_ROOT 内。 */
const resolveExistingPath = async (input: string): Promise<string> => {
  const target = resolvePath(input)
  const info = await lstat(target)
  if (info.isSymbolicLink()) throw new Error("不允许操作符号链接")
  const resolved = await realpath(target)
  assertWithinRoot(resolved)
  return resolved
}

const resolveExistingDirectory = async (input: string): Promise<string> => {
  const target = await resolveExistingPath(input)
  const info = await stat(target)
  if (!info.isDirectory()) throw new Error("不是目录")
  return target
}

/** target 是否等于 ancestor 或位于其之下。 */
const isInside = (ancestor: string, target: string): boolean =>
  target === ancestor ||
  target.startsWith(
    ancestor.endsWith(path.sep) ? ancestor : `${ancestor}${path.sep}`
  )

const toSeconds = (milliseconds: number): number =>
  Math.floor(milliseconds / 1000)

const toFileEntry = (
  dir: string,
  dirent: Dirent,
  info: { size: number; mtimeMs: number }
): FileEntry => ({
  name: dirent.name,
  path: path.join(dir, dirent.name),
  kind: dirent.isDirectory() ? "dir" : "file",
  // 目录不统计大小：为每个子目录多打一次递归 stat 不值得
  size: dirent.isDirectory() ? 0 : info.size,
  modified: toSeconds(info.mtimeMs),
})

const collectEntries = async (
  dir: string,
  dirents: Dirent[]
): Promise<FileEntry[]> => {
  const entries: FileEntry[] = []
  for (let index = 0; index < dirents.length; index += STAT_BATCH_SIZE) {
    const batch = dirents.slice(index, index + STAT_BATCH_SIZE)
    const batchEntries = await Promise.all(
      batch.map(async (dirent) => {
        const info = await stat(path.join(dir, dirent.name))
        return toFileEntry(dir, dirent, info)
      })
    )
    entries.push(...batchEntries)
  }
  return entries
}

/** 目录在前，其次按名称排序；大小与时间排序交给前端。 */
const byKindThenName = (left: FileEntry, right: FileEntry): number => {
  if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1
  return left.name.localeCompare(right.name, "zh-CN")
}

export const listDirectory = async (
  targetPath: string
): Promise<DirectoryResponse> => {
  const dir = await resolveExistingDirectory(targetPath)
  const dirents = (await readdir(dir, { withFileTypes: true })).filter(
    (dirent) =>
      (dirent.isDirectory() || dirent.isFile()) &&
      !dirent.name.endsWith(UPLOAD_PART_SUFFIX) &&
      !dirent.name.endsWith(OPERATION_PART_SUFFIX)
  )
  const entries = await collectEntries(dir, dirents)
  return { path: dir, entries: entries.sort(byKindThenName) }
}

export const createDirectory = async (
  parentPath: string,
  name: string
): Promise<void> => {
  const parent = await resolveExistingDirectory(parentPath)
  await mkdir(path.join(parent, assertSafeName(name)))
}

export const createFile = async (
  parentPath: string,
  name: string
): Promise<void> => {
  // flag "wx" 让同名文件直接失败，不覆盖已有内容
  const parent = await resolveExistingDirectory(parentPath)
  await writeFile(path.join(parent, assertSafeName(name)), "", {
    flag: "wx",
  })
}

export const renameEntry = async (
  targetPath: string,
  name: string
): Promise<void> => {
  const source = await resolveExistingPath(targetPath)
  const destination = path.join(path.dirname(source), assertSafeName(name))
  // macOS 的 rename 会静默覆盖同名条目，这里先挡住
  if (destination !== source && existsSync(destination)) {
    throw new Error("目标位置已存在同名条目")
  }
  await rename(source, destination)
}

/**
 * 递归删除并统计真实完成数。
 *
 * 保留原有安全策略：顶层目标先做符号链接与范围校验；遍历中遇到符号链接只删除链接
 * 本身，不跟随进入，避免越界删除。删除过程本身是逐项完成，因此进度是真实数字。
 */
const removeTree = async (
  target: string,
  counter: DeleteCounter,
  report: (progress: FileOperationProgress) => void,
  context: TransferContext,
  removeFile: typeof rm
): Promise<void> => {
  const info = await runTransferLimited(context, () => lstat(target))
  if (info.isDirectory()) {
    const names = await runTransferLimited(context, () => readdir(target))
    await mapWithLimit(
      names,
      (name) =>
        removeTree(
          path.join(target, name),
          counter,
          report,
          context,
          removeFile
        ),
      context
    )
    await runTransferLimited(context, () => rmdir(target))
    counter.removed += 1
    return
  }
  await runTransferLimited(context, () => removeFile(target, { force: false }))
  counter.removed += 1
  counter.done += 1
  counter.bytes += info.size
  report({
    done: counter.done,
    total: null,
    bytesDone: counter.bytes,
    stage: "删除中",
    currentTarget: target,
  })
}

export const deleteEntries = async (
  paths: string[],
  options?: OperationOptions
): Promise<FileBatchOutcome> => {
  const report = options?.report ?? noop
  const completed: string[] = []
  const failed: { path: string; message: string }[] = []
  const partial: { path: string; message: string }[] = []
  const counter: DeleteCounter = { done: 0, bytes: 0, removed: 0 }
  const removeFile = options?.io?.remove ?? rm
  report({
    done: 0,
    total: null,
    bytesDone: 0,
    stage: "删除中",
    currentTarget: null,
  })

  for (const item of paths) {
    const removedBefore = counter.removed
    try {
      const target = await resolveExistingPath(item)
      await removeTree(
        target,
        counter,
        report,
        createTransferContext(),
        removeFile
      )
      completed.push(target)
    } catch (error) {
      const removed = counter.removed - removedBefore
      if (removed > 0) {
        partial.push({
          path: item,
          message: `已移除 ${removed} 项，但删除其余内容失败：${describeFileError(error)}`,
        })
      } else {
        failed.push({ path: item, message: describeFileError(error) })
      }
    }
  }

  return { completed, failed, partial, skipped: [], bytes: null }
}

const copyRecursive = async (
  source: string,
  destination: string,
  counter: TransferCounter,
  report: (progress: FileOperationProgress) => void,
  context: TransferContext,
  copyFileTo: typeof copyFile
): Promise<void> => {
  const sourceInfo = await runTransferLimited(context, () => lstat(source))
  if (sourceInfo.isSymbolicLink()) {
    throw new Error("不允许复制符号链接")
  }
  if (sourceInfo.isDirectory()) {
    await runTransferLimited(context, () =>
      mkdir(destination, { recursive: true })
    )
    const items = await runTransferLimited(context, () => readdir(source))
    await mapWithLimit(
      items,
      (item) =>
        copyRecursive(
          path.join(source, item),
          path.join(destination, item),
          counter,
          report,
          context,
          copyFileTo
        ),
      context
    )
    return
  }
  if (!sourceInfo.isFile()) {
    throw new Error("不支持复制非普通文件")
  }
  await runTransferLimited(context, () =>
    copyFileTo(source, destination, constants.COPYFILE_EXCL)
  )
  counter.done += 1
  counter.bytes += sourceInfo.size
  report({
    done: counter.done,
    total: null,
    bytesDone: counter.bytes,
    stage: "复制中",
    currentTarget: source,
  })
}

type PublishedEntries = {
  files: { destination: string; dev: number; ino: number }[]
  directories: { path: string; dev: number; ino: number }[]
}

const rollbackPublishedEntries = async (
  entries: PublishedEntries
): Promise<string[]> => {
  const failures: string[] = []
  for (const file of [...entries.files].reverse()) {
    try {
      const targetInfo = await lstat(file.destination)
      if (targetInfo.dev !== file.dev || targetInfo.ino !== file.ino) {
        failures.push(`目标已变化，未删除：${file.destination}`)
        continue
      }
      await rm(file.destination, { force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        failures.push(`${file.destination}：${describeFileError(error)}`)
      }
    }
  }
  for (const directory of [...entries.directories].reverse()) {
    try {
      const current = await lstat(directory.path)
      if (current.dev !== directory.dev || current.ino !== directory.ino) {
        failures.push(`目录已变化，未删除：${directory.path}`)
        continue
      }
      await rmdir(directory.path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        failures.push(`${directory.path}：${describeFileError(error)}`)
      }
    }
  }
  return failures
}

const publishStagedDirectory = async (
  staging: string,
  destination: string,
  context: TransferContext,
  linkFile: typeof link,
  published: PublishedEntries
): Promise<void> => {
  const entries = await runTransferLimited(context, () =>
    readdir(staging, { withFileTypes: true })
  )
  await mapWithLimit(
    entries,
    async (entry) => {
      const stagedPath = path.join(staging, entry.name)
      const targetPath = path.join(destination, entry.name)
      const info = await runTransferLimited(context, () => lstat(stagedPath))
      if (info.isSymbolicLink()) {
        throw new Error("临时副本中出现不允许提交的符号链接")
      }
      if (info.isDirectory()) {
        const targetInfo = await runTransferLimited(context, async () => {
          await mkdir(targetPath)
          return lstat(targetPath)
        })
        published.directories.push({
          path: targetPath,
          dev: targetInfo.dev,
          ino: targetInfo.ino,
        })
        await publishStagedDirectory(
          stagedPath,
          targetPath,
          context,
          linkFile,
          published
        )
        return
      }
      if (!info.isFile()) throw new Error("临时副本包含非普通文件")
      // 记录 staged inode，link 与记录在同一受控操作后续中完成，避免失败竞态漏记。
      await runTransferLimited(context, async () => {
        await linkFile(stagedPath, targetPath)
        published.files.push({
          destination: targetPath,
          dev: info.dev,
          ino: info.ino,
        })
      })
    },
    context
  )
}

class PartialFileOperationError extends Error {
  constructor(
    readonly destination: string,
    message: string
  ) {
    super(message)
    this.name = "PartialFileOperationError"
  }
}

const copyToDestination = async (
  source: string,
  destination: string,
  counter: TransferCounter,
  report: (progress: FileOperationProgress) => void,
  options?: OperationOptions
): Promise<void> => {
  const context = createTransferContext()
  const copyFileTo = options?.io?.copyFile ?? copyFile
  const linkFile = options?.io?.link ?? link
  const staging = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${randomUUID()}${OPERATION_PART_SUFFIX}`
  )
  let stagingCreated = false
  let publishedSuccessfully = false
  const published: PublishedEntries = { files: [], directories: [] }
  let failure: unknown
  let hasFailure = false

  try {
    await runTransferLimited(context, () => mkdir(staging))
    stagingCreated = true
    const info = await runTransferLimited(context, () => lstat(source))
    if (info.isSymbolicLink()) throw new Error("不允许复制符号链接")
    if (info.isDirectory()) {
      await copyRecursive(source, staging, counter, report, context, copyFileTo)
      const rootInfo = await runTransferLimited(context, async () => {
        await mkdir(destination)
        return lstat(destination)
      })
      published.directories.push({
        path: destination,
        dev: rootInfo.dev,
        ino: rootInfo.ino,
      })
      await publishStagedDirectory(
        staging,
        destination,
        context,
        linkFile,
        published
      )
    } else if (info.isFile()) {
      const stagedFile = path.join(staging, "content")
      await runTransferLimited(context, () =>
        copyFileTo(source, stagedFile, constants.COPYFILE_EXCL)
      )
      counter.done += 1
      counter.bytes += info.size
      report({
        done: counter.done,
        total: null,
        bytesDone: counter.bytes,
        stage: "复制中",
        currentTarget: source,
      })
      const stagedInfo = await runTransferLimited(context, () =>
        lstat(stagedFile)
      )
      await runTransferLimited(context, async () => {
        await linkFile(stagedFile, destination)
        published.files.push({
          destination,
          dev: stagedInfo.dev,
          ino: stagedInfo.ino,
        })
      })
    } else {
      throw new Error("不支持复制非普通文件")
    }
    publishedSuccessfully = true
  } catch (error) {
    hasFailure = true
    failure = error
  }

  if (
    hasFailure &&
    (published.files.length > 0 || published.directories.length > 0)
  ) {
    const cleanupFailures = await rollbackPublishedEntries(published)
    if (cleanupFailures.length > 0) {
      failure = new PartialFileOperationError(
        destination,
        `复制未完成，目标清理不完整：${cleanupFailures.join("；")}`
      )
    }
  }

  if (stagingCreated) {
    try {
      await rm(staging, { recursive: true, force: true })
    } catch (error) {
      failure = new PartialFileOperationError(
        publishedSuccessfully ? destination : staging,
        `${publishedSuccessfully ? "目标已复制" : "复制未提交"}，临时副本 ${staging} 清理失败：${describeFileError(error)}`
      )
      hasFailure = true
    }
  }

  if (hasFailure) throw failure
}

/** 复制与移动共用的目标校验，返回已解析的目标目录。 */
const resolveTransferTarget = async (
  paths: string[],
  destPath: string
): Promise<string> => {
  const destination = await resolveExistingDirectory(destPath)
  for (const item of paths) {
    const source = await resolveExistingPath(item)
    if (isInside(source, destination)) {
      throw new Error("不能把目录操作到自身或其子目录")
    }
    if (path.dirname(source) === destination) {
      throw new Error("源与目标在同一目录")
    }
  }
  return destination
}

export const copyEntries = async (
  paths: string[],
  destPath: string,
  options?: OperationOptions
): Promise<FileBatchOutcome> => {
  const report = options?.report ?? noop
  const destination = await resolveTransferTarget(paths, destPath)
  const completed: string[] = []
  const failed: { path: string; message: string }[] = []
  const partial: { path: string; destination?: string; message: string }[] = []
  const counter = { done: 0, bytes: 0 }

  for (const item of paths) {
    try {
      const source = await resolveExistingPath(item)
      const target = path.join(destination, path.basename(source))
      if (existsSync(target)) {
        throw new Error(`目标已存在同名条目：${path.basename(source)}`)
      }
      await copyToDestination(source, target, counter, report, options)
      completed.push(source)
    } catch (error) {
      if (error instanceof PartialFileOperationError) {
        partial.push({
          path: item,
          destination: error.destination,
          message: error.message,
        })
      } else {
        failed.push({ path: item, message: describeFileError(error) })
      }
    }
  }

  return { completed, failed, partial, skipped: [], bytes: counter.bytes }
}

export const moveEntries = async (
  paths: string[],
  destPath: string,
  options?: OperationOptions
): Promise<FileBatchOutcome> => {
  const report = options?.report ?? noop
  const renameFile = options?.io?.rename ?? rename
  const removeFile = options?.io?.remove ?? rm
  const destination = await resolveTransferTarget(paths, destPath)
  const completed: string[] = []
  const failed: { path: string; message: string }[] = []
  const partial: { path: string; destination?: string; message: string }[] = []
  const progress = { done: 0, bytes: 0 }
  let writtenBytes = 0

  for (const item of paths) {
    try {
      const source = await resolveExistingPath(item)
      const target = path.join(destination, path.basename(source))
      if (existsSync(target)) {
        throw new Error(`目标已存在同名条目：${path.basename(source)}`)
      }
      try {
        await renameFile(source, target)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error

        const bytesBeforeCopy = progress.bytes
        await copyToDestination(source, target, progress, report, options)
        writtenBytes += progress.bytes - bytesBeforeCopy

        const deletion: DeleteCounter = {
          done: progress.done,
          bytes: progress.bytes,
          removed: 0,
        }
        try {
          await removeTree(
            source,
            deletion,
            report,
            createTransferContext(),
            removeFile
          )
          progress.done = deletion.done
          progress.bytes = deletion.bytes
        } catch (deleteError) {
          progress.done = deletion.done
          progress.bytes = deletion.bytes
          partial.push({
            path: item,
            destination: target,
            message: `已复制到目标，但源路径未能完整删除${deletion.removed > 0 ? `（已移除 ${deletion.removed} 项）` : ""}：${describeFileError(deleteError)}`,
          })
          continue
        }
      }
      completed.push(source)
    } catch (error) {
      if (error instanceof PartialFileOperationError) {
        partial.push({
          path: item,
          destination: error.destination,
          message: error.message,
        })
      } else {
        failed.push({ path: item, message: describeFileError(error) })
      }
    }
  }

  return {
    completed,
    failed,
    partial,
    skipped: [],
    bytes: writtenBytes,
  }
}

export const readFileContent = async (
  targetPath: string
): Promise<FileContentResponse> => {
  const value = await resolveExistingPath(targetPath)
  const info = await stat(value)
  if (!info.isFile()) {
    throw new Error("不是文件")
  }
  if (!isEditableTextFile(path.basename(value))) {
    throw new Error("该文件类型不支持在线编辑")
  }
  if (info.size > MAX_EDITABLE_BYTES) {
    throw new Error(
      `文件超过 ${Math.floor(MAX_EDITABLE_BYTES / 1024 / 1024)} MB，不支持在线编辑`
    )
  }
  const content = await readFile(value, "utf8")
  if (content.includes("\u0000")) {
    throw new Error("二进制文件不支持在线编辑")
  }
  return {
    path: value,
    content,
    size: info.size,
    modified: toSeconds(info.mtimeMs),
  }
}

export const writeFileContent = async (
  targetPath: string,
  content: string
): Promise<void> => {
  const value = await resolveExistingPath(targetPath)
  const info = await stat(value)
  if (!info.isFile()) {
    throw new Error("不是文件")
  }
  if (!isEditableTextFile(path.basename(value))) {
    throw new Error("该文件类型不支持在线编辑")
  }
  if (Buffer.byteLength(content, "utf8") > MAX_EDITABLE_BYTES) {
    throw new Error("文件内容超过 2 MB，不支持保存")
  }
  const tempPath = `${value}.writing`
  try {
    await writeFile(tempPath, content, { encoding: "utf8", flag: "wx" })
    await rename(tempPath, value)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}

export type DownloadHandle = {
  stream: ReadStream
  size: number
  name: string
}

export const openDownload = async (
  targetPath: string
): Promise<DownloadHandle> => {
  const value = await resolveExistingPath(targetPath)
  const info = await stat(value)
  if (!info.isFile()) {
    throw new Error("只能下载文件")
  }
  return {
    stream: createReadStream(value),
    size: info.size,
    name: path.basename(value),
  }
}

/**
 * 接收上传：先写目标目录内的临时分片，收完再 rename 提交，保证同盘一次写盘。
 * 失败时清理分片，不留半成品。
 */
export const receiveUpload = async (
  targetPath: string,
  relativePath: string,
  source: Readable
): Promise<FileEntry> => {
  const destRoot = await resolveExistingDirectory(targetPath)
  const segments = relativePath.split("/").filter(Boolean).map(assertSafeName)
  const fileName = segments.pop()
  if (!fileName) {
    throw new Error("非法名称")
  }
  const dir = path.join(destRoot, ...segments)
  const destination = path.join(dir, fileName)
  const partPath = `${destination}${UPLOAD_PART_SUFFIX}`

  await mkdir(dir, { recursive: true })
  if (existsSync(destination)) {
    throw new Error("目标已存在同名文件")
  }
  if (existsSync(partPath)) {
    throw new Error("该文件正在上传中")
  }
  try {
    const limiter = new Transform({
      transform(chunk: unknown, _encoding, callback) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
        if (data.length > MAX_UPLOAD_BYTES - bytes) {
          callback(new Error("上传文件超过 512 MB 限制"))
          return
        }
        bytes += data.length
        callback(null, data)
      },
    })
    let bytes = 0
    await pipeline(source, limiter, createWriteStream(partPath))
    await rename(partPath, destination)
  } catch (error) {
    await rm(partPath, { force: true })
    throw error
  }

  const info = await stat(destination)
  return {
    name: fileName,
    path: destination,
    kind: "file",
    size: info.size,
    modified: toSeconds(info.mtimeMs),
  }
}
