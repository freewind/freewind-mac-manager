import { ApiPath, toContractPath } from "@shared/api-path"
import { c } from "../init"
import { ActionResponseSchema, ApiErrorSchema } from "../schemas/common"
import {
  DeleteScansQuerySchema,
  EntriesQuerySchema,
  EntriesResponseSchema,
  EntryPathBodySchema,
  EntryPathQuerySchema,
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
    path: toContractPath(ApiPath.diskGrowthScans),
    responses: {
      200: ScansResponseSchema,
      ...errorResponses,
    },
  },
  listEntries: {
    method: "GET",
    path: toContractPath(ApiPath.diskGrowthEntries),
    query: EntriesQuerySchema,
    responses: {
      200: EntriesResponseSchema,
      ...errorResponses,
    },
  },
  subtree: {
    method: "GET",
    path: toContractPath(ApiPath.diskGrowthTree),
    query: TreeQuerySchema,
    responses: {
      200: TreeResponseSchema,
      ...errorResponses,
    },
  },
  scanStatus: {
    method: "GET",
    path: toContractPath(ApiPath.diskGrowthScanStatus),
    responses: {
      200: ScanStatusSchema,
      ...errorResponses,
    },
  },
  startScan: {
    method: "POST",
    path: toContractPath(ApiPath.diskGrowthScan),
    body: c.noBody(),
    responses: {
      202: ScanStartResponseSchema,
      ...errorResponses,
    },
  },
  revealEntry: {
    method: "POST",
    path: toContractPath(ApiPath.diskGrowthReveal),
    body: EntryPathBodySchema,
    responses: {
      202: ActionResponseSchema,
      ...errorResponses,
    },
  },
  deleteScans: {
    method: "DELETE",
    path: toContractPath(ApiPath.diskGrowthScans),
    query: DeleteScansQuerySchema,
    responses: {
      202: ActionResponseSchema,
      ...errorResponses,
    },
  },
  trashEntry: {
    method: "DELETE",
    path: toContractPath(ApiPath.diskGrowthEntry),
    query: EntryPathQuerySchema,
    responses: {
      202: ActionResponseSchema,
      ...errorResponses,
    },
  },
} as const
