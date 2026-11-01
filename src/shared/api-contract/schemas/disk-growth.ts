import { z } from "zod"

export const ScanSnapshotSchema = z.object({
  id: z.number(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  totalSize: z.number(),
  dirCount: z.number(),
  fileCount: z.number(),
  errorCount: z.number(),
  foldedCount: z.number(),
})

export const GrowthEntrySchema = z.object({
  path: z.string(),
  name: z.string(),
  kind: z.enum(["dir", "file"]),
  size: z.number(),
  delta: z.number(),
  folded: z.boolean(),
})

export const ScansResponseSchema = z.object({
  snapshots: z.array(ScanSnapshotSchema),
})

/**
 * 扫描任务完成后的结果：只带足以定位快照与说明规模的字段，
 * 条文明细仍由 listEntries/subtree 按需读取，不进入任务记录。
 *
 * 手动扫描只做对比、不落库：此时 saved 为 false、snapshotId 为 null，
 * 差值相对库中最新快照给出，避免手动查看挤掉定时快照、破坏对比基线。
 */
export const ScanTaskResultSchema = z.object({
  snapshotId: z.number().nullable(),
  saved: z.boolean(),
  baselineSnapshotId: z.number().nullable(),
  deltaTotalSize: z.number().nullable(),
  deltaFileCount: z.number().nullable(),
  fileCount: z.number(),
  dirCount: z.number(),
  totalSize: z.number(),
})

export const EntriesQuerySchema = z.object({
  scanId: z.coerce.number().int().positive(),
  baselineScanId: z.coerce.number().int().positive().optional(),
  path: z.string().default(""),
  keyword: z.string().optional(),
})

export const DeleteScansQuerySchema = z.object({
  scanIds: z.string().min(1),
})

export const EntriesResponseSchema = z.object({
  current: GrowthEntrySchema.nullable(),
  entries: z.array(GrowthEntrySchema),
})

export const ScanStartResponseSchema = z.object({
  started: z.boolean(),
  message: z.string(),
})

export const EntryPathBodySchema = z.object({
  path: z.string().min(1),
})

export const EntryPathQuerySchema = z.object({
  path: z.string().min(1),
})

export const TreeQuerySchema = z.object({
  scanId: z.coerce.number().int().positive(),
  baselineScanId: z.coerce.number().int().positive().optional(),
  path: z.string().default(""),
  depth: z.coerce.number().int().min(1).max(8).default(4),
})

export type TreeNodeWire = {
  path: string
  name: string
  kind: "dir" | "file"
  size: number
  delta: number
  folded: boolean
  children: TreeNodeWire[]
}

export const TreeNodeSchema: z.ZodType<TreeNodeWire> = z.lazy(() =>
  z.object({
    path: z.string(),
    name: z.string(),
    kind: z.enum(["dir", "file"]),
    size: z.number(),
    delta: z.number(),
    folded: z.boolean(),
    children: z.array(TreeNodeSchema),
  })
)

export const TreeResponseSchema = z.object({
  root: TreeNodeSchema.nullable(),
})
