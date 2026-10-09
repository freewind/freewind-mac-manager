import { API_BASE, ApiPath, toContractPath } from "@shared/api-path"
import { c } from "../init"
import { ActionResponseSchema, ApiErrorSchema } from "../schemas/common"
import {
  DeleteScansQuerySchema,
  EntriesQuerySchema,
  EntryPathBodySchema,
  EntryPathQuerySchema,
  EntriesResponseSchema,
  ScanStartResponseSchema,
  ScanStatusSchema,
  ScansResponseSchema,
  TreeQuerySchema,
  TreeResponseSchema,
} from "../schemas/disk-growth"

const errorResponses = {
  400: ApiErrorSchema,
  500: ApiErrorSchema,
} as const

export const diskGrowthRoutes = {
  listScans: {
    method: "GET",
    path: toContractPath(ApiPath[`${API_BASE}/disk-growth/scans`]),
    responses: {
      200: ScansResponseSchema,
      ...errorResponses,
    },
  },
  listEntries: {
    method: "GET",
    path: toContractPath(ApiPath[`${API_BASE}/disk-growth/entries`]),
    query: EntriesQuerySchema,
    responses: {
      200: EntriesResponseSchema,
      ...errorResponses,
    },
  },
  subtree: {
    method: "GET",
    path: toContractPath(ApiPath[`${API_BASE}/disk-growth/tree`]),
    query: TreeQuerySchema,
    responses: {
      200: TreeResponseSchema,
      ...errorResponses,
    },
  },
  scanStatus: {
    method: "GET",
    path: toContractPath(ApiPath[`${API_BASE}/disk-growth/scan-status`]),
    responses: {
      200: ScanStatusSchema,
      ...errorResponses,
    },
  },
  startScan: {
    method: "POST",
    path: toContractPath(ApiPath[`${API_BASE}/disk-growth/scan`]),
    body: c.noBody(),
    responses: {
      202: ScanStartResponseSchema,
      ...errorResponses,
    },
  },
  revealEntry: {
    method: "POST",
    path: toContractPath(ApiPath[`${API_BASE}/disk-growth/reveal`]),
    body: EntryPathBodySchema,
    responses: {
      202: ActionResponseSchema,
      ...errorResponses,
    },
  },
  deleteScans: {
    method: "DELETE",
    path: toContractPath(ApiPath[`${API_BASE}/disk-growth/scans`]),
    query: DeleteScansQuerySchema,
    responses: {
      202: ActionResponseSchema,
      ...errorResponses,
    },
  },
  trashEntry: {
    method: "DELETE",
    path: toContractPath(ApiPath[`${API_BASE}/disk-growth/entry`]),
    query: EntryPathQuerySchema,
    responses: {
      202: ActionResponseSchema,
      ...errorResponses,
    },
  },
} as const
