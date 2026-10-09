import { z } from "zod"

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

export const OkResponseSchema = z.object({
  ok: z.literal(true),
})

export const UploadResponseSchema = OkResponseSchema.extend({
  file: FileEntrySchema,
})
