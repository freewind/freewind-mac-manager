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

export const ScanStatusSchema = z.object({
  running: z.boolean(),
  phase: z.string(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  scannedEntries: z.number(),
  lastError: z.string().nullable(),
})

export const ScansResponseSchema = z.object({
  snapshots: z.array(ScanSnapshotSchema),
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

export const ApiErrorSchema = z.object({
  message: z.string(),
})

export const EntryPathBodySchema = z.object({
  path: z.string().min(1),
})

export const EntryPathQuerySchema = z.object({
  path: z.string().min(1),
})

export const ActionResponseSchema = z.object({
  message: z.string(),
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
