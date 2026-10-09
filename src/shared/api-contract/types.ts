import { z } from "zod"
import {
  ApiErrorSchema,
  EntriesResponseSchema,
  GrowthEntrySchema,
  ScanSnapshotSchema,
  ScanStartResponseSchema,
  ScanStatusSchema,
  ScansResponseSchema,
} from "./schemas/disk-growth"

export type ScanSnapshot = z.infer<typeof ScanSnapshotSchema>
export type GrowthEntry = z.infer<typeof GrowthEntrySchema>
export type ScanStatus = z.infer<typeof ScanStatusSchema>
export type ScansResponse = z.infer<typeof ScansResponseSchema>
export type EntriesResponse = z.infer<typeof EntriesResponseSchema>
export type ScanStartResponse = z.infer<typeof ScanStartResponseSchema>
export type ApiError = z.infer<typeof ApiErrorSchema>

import {
  KillPortProcessResultSchema,
  KillPortProcessesBodySchema,
  KillPortProcessesResponseSchema,
  PortBindingSchema,
  PortBindingsResponseSchema,
} from "./schemas/ports"

export type PortBinding = z.infer<typeof PortBindingSchema>
export type PortBindingsResponse = z.infer<typeof PortBindingsResponseSchema>
export type KillPortProcessesBody = z.infer<typeof KillPortProcessesBodySchema>
export type KillPortProcessResult = z.infer<typeof KillPortProcessResultSchema>
export type KillPortProcessesResponse = z.infer<
  typeof KillPortProcessesResponseSchema
>
