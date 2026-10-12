import { z } from "zod"
import { ActionResponseSchema } from "./common"

export const FileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(["dir", "file"]),
  /** 目录为 0，避免为每个子目录多打一次 stat */
  size: z.number(),
  /** 修改时间，秒级时间戳 */
  modified: z.number(),
})

export const DirectoryResponseSchema = z.object({
  path: z.string(),
  entries: z.array(FileEntrySchema),
})

export const FileContentResponseSchema = z.object({
  path: z.string(),
  content: z.string(),
  size: z.number(),
  modified: z.number(),
})

export const PathQuerySchema = z.object({
  path: z.string().default(""),
})

/**
 * ts-rest client 把数组编码成 `paths[0]=…&paths[1]=…`，
 * 服务端因此必须使用 extended query parser 才能还原成数组。
 */
export const PathsQuerySchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(64),
})

export const CreateEntryBodySchema = z.object({
  parentPath: z.string(),
  name: z.string().min(1),
})

export const RenameEntryBodySchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
})

export const TransferEntriesBodySchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(64),
  destPath: z.string().min(1),
})

export const SaveFileContentBodySchema = z.object({
  path: z.string().min(1),
  content: z.string().max(2 * 1024 * 1024),
})

export const UploadResponseSchema = ActionResponseSchema.extend({
  file: FileEntrySchema,
})

/**
 * 目录内搜索：先按文件名匹配，开searchContent 时再读文件内容匹配。
 * 只做本地只读扫描，不建索引；深度、条数与查询串长度都有硬上限。
 */
export const FileSearchModeSchema = z.enum(["exact", "wildcard", "substring"])

export const FileSearchQuerySchema = z.object({
  root: z.string().default(""),
  query: z.string().min(1).max(256),
  mode: FileSearchModeSchema.default("substring"),
  caseSensitive: z.coerce.boolean().default(false),
  searchContent: z.coerce.boolean().default(false),
  maxDepth: z.coerce.number().int().min(1).max(8).default(3),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

export const FileSearchMatchSchema = z.object({
  path: z.string(),
  name: z.string(),
  kind: z.enum(["dir", "file"]),
  size: z.number(),
  modified: z.number(),
  /** 命中来源：文件名或文件内容；两种模式的结果可据此区分。 */
  source: z.enum(["name", "content"]),
  /** 内容命中的那一行（截断后）；文件名命中时为 null。 */
  snippet: z.string().nullable(),
  lineNumber: z.number().nullable(),
})

export const FileSearchResponseSchema = z.object({
  root: z.string(),
  query: z.string(),
  matches: z.array(FileSearchMatchSchema),
  /** 实际读过的候选文件数，供上限说明与排查。 */
  scannedFiles: z.number(),
  /** 因为条数或扫描上限而截断时为 true，不谎报完整结果。 */
  truncated: z.boolean(),
})

/**
 * 复制、删除、移动这类批量操作的结果：逐项可核实，允许部分完成。
 * 不把整棵目录树的明细写进任务记录，只留已处理的条目与失败原因。
 */
export const FileBatchFailureSchema = z.object({
  path: z.string(),
  message: z.string(),
})

export const FileBatchPartialSchema = FileBatchFailureSchema.extend({
  destination: z.string().optional(),
})

export const FileBatchResultSchema = z.object({
  completed: z.array(z.string()),
  failed: z.array(FileBatchFailureSchema),
  /** 已产生部分副作用、但不能宣称整项完成的目标。旧任务记录可省略此字段。 */
  partial: z.array(FileBatchPartialSchema).optional(),
  /** 因为冲突或状态变化而没有执行的条目。 */
  skipped: z.array(z.string()),
  /** 复制/移动实际写入的字节数；删除等不适用时为 null。 */
  bytes: z.number().min(0).nullable(),
})
