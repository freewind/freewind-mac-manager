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
  path: z.string().default(""),
  keyword: z.string().optional(),
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
