import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import type { FileSearchMatch, FileSearchResponse } from "@shared/api-contract"
import { isInside, resolveExistingDirectory } from "./service"

const execFileAsync = promisify(execFile)

/** 单次搜索的硬边界：命令超时、读文件上限与数量上限，避免一次搜索拖垮服务。 */
export const SEARCH_TIMEOUT_MS = 10_000
export const SEARCH_SCANNED_FILE_LIMIT = 2000
export const SEARCH_MAX_FILE_BYTES = 2 * 1024 * 1024
export const SEARCH_SNIPPET_MAX_CHARS = 200
const FIND_MAX_BUFFER = 16 * 1024 * 1024

export type FileSearchInput = {
  root: string
  query: string
  mode: "exact" | "wildcard" | "substring"
  caseSensitive: boolean
  searchContent: boolean
  maxDepth: number
  limit: number
}

/** 文件名匹配；通配模式只认 `*` 与 `?`，其它字符按字面处理。 */
export const matchFileName = (
  name: string,
  query: string,
  mode: FileSearchInput["mode"],
  caseSensitive: boolean
): boolean => {
  const haystack = caseSensitive ? name : name.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()

  if (mode === "exact") return haystack === needle
  if (mode === "substring") return haystack.includes(needle)
  const pattern = needle
    .split("")
    .map((char) => {
      if (char === "*") return ".*"
      if (char === "?") return "."
      // 其余正则元字符转义，用户输入里的 . ( ) [ ] 等按字面匹配
      return char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    })
    .join("")
  return new RegExp(`^${pattern}$`).test(haystack)
}

/** 内容匹配：返回首个命中行（截断）与行号，行号从 1 开始。 */
export const findSnippet = (
  content: string,
  query: string,
  caseSensitive: boolean
): { lineNumber: number; text: string } | null => {
  const needle = caseSensitive ? query : query.toLowerCase()
  const lines = content.split("\n")
  for (const [index, line] of lines.entries()) {
    const haystack = caseSensitive ? line : line.toLowerCase()
    if (haystack.includes(needle)) {
      return {
        lineNumber: index + 1,
        text: line.slice(0, SEARCH_SNIPPET_MAX_CHARS),
      }
    }
  }
  return null
}

/**
 * 用系统 `find` 列出候选文件。
 *
 * 只做一次有界扫描：`-maxdepth` 限深、`-type f` 只要文件、超时终止。
 * 参数走数组，不拼 shell 文本，目录名里的空格与特殊字符不会变成命令。
 */
export const listCandidateFiles = async (
  directory: string,
  maxDepth: number
): Promise<string[]> => {
  const { stdout } = await execFileAsync(
    "/usr/bin/find",
    [directory, "-maxdepth", String(maxDepth), "-type", "f", "-print"],
    { timeout: SEARCH_TIMEOUT_MS, maxBuffer: FIND_MAX_BUFFER }
  )
  return stdout.split("\n").filter((line) => line.length > 0)
}

/**
 * 目录内搜索：先匹配文件名，开了内容搜索再读文件逐行匹配。
 *
 * 不建索引、不写磁盘；命中条数达到 limit 或读过候选文件达到
 * SEARCH_SCANNED_FILE_LIMIT 时立刻停止，并把 truncated 如实置为 true。
 */
export const searchFiles = async (
  input: FileSearchInput
): Promise<FileSearchResponse> => {
  const root = await resolveExistingDirectory(input.root)
  const candidates = await listCandidateFiles(root, input.maxDepth)
  const matches: FileSearchMatch[] = []
  let scannedFiles = 0
  let truncated = false

  for (const filePath of candidates) {
    if (matches.length >= input.limit) {
      truncated = true
      break
    }
    if (scannedFiles >= SEARCH_SCANNED_FILE_LIMIT) {
      truncated = true
      break
    }
    // find 的结果经过符号链接时可能落在根目录之外，逐个再校验一次
    if (!isInside(root, filePath)) continue

    const info = await fs.stat(filePath).catch(() => null)
    if (!info?.isFile()) continue
    scannedFiles += 1

    const base = {
      path: filePath,
      name: path.basename(filePath),
      kind: "file" as const,
      size: info.size,
      modified: Math.floor(info.mtimeMs / 1000),
    }

    if (
      matchFileName(base.name, input.query, input.mode, input.caseSensitive)
    ) {
      matches.push({ ...base, source: "name", snippet: null, lineNumber: null })
      continue
    }
    if (!input.searchContent) continue
    if (info.size > SEARCH_MAX_FILE_BYTES) continue

    // 二进制文件按 UTF-8 读出来会是乱码：读失败就跳过，不当成命中
    const content = await fs.readFile(filePath, "utf8").catch(() => null)
    if (content === null) continue
    const hit = findSnippet(content, input.query, input.caseSensitive)
    if (hit) {
      matches.push({
        ...base,
        source: "content",
        snippet: hit.text,
        lineNumber: hit.lineNumber,
      })
    }
  }

  return {
    root,
    query: input.query,
    matches,
    scannedFiles,
    truncated,
  }
}
