import { createReadStream, createWriteStream, existsSync } from "node:fs"
import type { Dirent, ReadStream } from "node:fs"
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import type { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type {
  DirectoryResponse,
  FileContentResponse,
  FileEntry,
} from "@shared/api-contract"
import { FILE_ROOT } from "@server/env"

/** 上传中的临时后缀；带此后缀的文件不出现在目录列表里。 */
const UPLOAD_PART_SUFFIX = ".uploading.part"

/** 在线编辑的大小上限，超过直接拒绝，避免把大文件读进内存。 */
const MAX_EDITABLE_BYTES = 2 * 1024 * 1024

/** 批量 stat 的批大小，避免一次对大目录的每个条目同时发起请求。 */
const STAT_BATCH_SIZE = 64

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
  return error instanceof Error ? error.message : String(error)
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
  const dir = resolvePath(targetPath)
  const info = await stat(dir)
  if (!info.isDirectory()) {
    throw new Error("不是目录")
  }
  const dirents = (await readdir(dir, { withFileTypes: true })).filter(
    (dirent) =>
      (dirent.isDirectory() || dirent.isFile()) &&
      !dirent.name.endsWith(UPLOAD_PART_SUFFIX)
  )
  const entries = await collectEntries(dir, dirents)
  return { path: dir, entries: entries.sort(byKindThenName) }
}

export const createDirectory = async (
  parentPath: string,
  name: string
): Promise<void> => {
  await mkdir(path.join(resolvePath(parentPath), assertSafeName(name)))
}

export const createFile = async (
  parentPath: string,
  name: string
): Promise<void> => {
  // flag "wx" 让同名文件直接失败，不覆盖已有内容
  await writeFile(
    path.join(resolvePath(parentPath), assertSafeName(name)),
    "",
    {
      flag: "wx",
    }
  )
}

export const renameEntry = async (
  targetPath: string,
  name: string
): Promise<void> => {
  const source = resolvePath(targetPath)
  const destination = path.join(path.dirname(source), assertSafeName(name))
  // macOS 的 rename 会静默覆盖同名条目，这里先挡住
  if (destination !== source && existsSync(destination)) {
    throw new Error("目标位置已存在同名条目")
  }
  await rename(source, destination)
}

export const deleteEntries = async (paths: string[]): Promise<void> => {
  await Promise.all(
    paths.map((item) =>
      rm(resolvePath(item), { recursive: true, force: false })
    )
  )
}

const copyRecursive = async (
  source: string,
  destination: string
): Promise<void> => {
  const info = await stat(source)
  if (!info.isDirectory()) {
    await copyFile(source, destination)
    return
  }
  await mkdir(destination, { recursive: true })
  const items = await readdir(source)
  await Promise.all(
    items.map((item) =>
      copyRecursive(path.join(source, item), path.join(destination, item))
    )
  )
}

/** 复制与移动共用的目标校验，返回已解析的目标目录。 */
const resolveTransferTarget = async (
  paths: string[],
  destPath: string
): Promise<string> => {
  const destination = resolvePath(destPath)
  const info = await stat(destination)
  if (!info.isDirectory()) {
    throw new Error("目标不是目录")
  }
  for (const item of paths) {
    const source = resolvePath(item)
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
  destPath: string
): Promise<void> => {
  const destination = await resolveTransferTarget(paths, destPath)
  await Promise.all(
    paths.map(async (item) => {
      const source = resolvePath(item)
      const target = path.join(destination, path.basename(source))
      if (existsSync(target)) {
        throw new Error(`目标已存在同名条目：${path.basename(source)}`)
      }
      await copyRecursive(source, target)
    })
  )
}

export const moveEntries = async (
  paths: string[],
  destPath: string
): Promise<void> => {
  const destination = await resolveTransferTarget(paths, destPath)
  await Promise.all(
    paths.map(async (item) => {
      const source = resolvePath(item)
      const target = path.join(destination, path.basename(source))
      if (existsSync(target)) {
        throw new Error(`目标已存在同名条目：${path.basename(source)}`)
      }
      try {
        await rename(source, target)
      } catch (error) {
        // 跨卷时 rename 报 EXDEV，退化成复制 + 删除；其它错误照原样抛出
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
          throw error
        }
        await copyRecursive(source, target)
        await rm(source, { recursive: true, force: false })
      }
    })
  )
}

export const readFileContent = async (
  targetPath: string
): Promise<FileContentResponse> => {
  const value = resolvePath(targetPath)
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
  const value = resolvePath(targetPath)
  const info = await stat(value)
  if (!info.isFile()) {
    throw new Error("不是文件")
  }
  if (!isEditableTextFile(path.basename(value))) {
    throw new Error("该文件类型不支持在线编辑")
  }
  await writeFile(value, content, "utf8")
}

export type DownloadHandle = {
  stream: ReadStream
  size: number
  name: string
}

export const openDownload = async (
  targetPath: string
): Promise<DownloadHandle> => {
  const value = resolvePath(targetPath)
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
  const destRoot = resolvePath(targetPath)
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
    await pipeline(source, createWriteStream(partPath))
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
