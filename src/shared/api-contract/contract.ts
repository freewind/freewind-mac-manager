import { API_BASE, ApiPath, toContractPath } from "@shared/api-path"
import { z } from "zod"
import { c } from "./init"
import {
  ApiErrorSchema,
  EntriesQuerySchema,
  EntriesResponseSchema,
  ScanStartResponseSchema,
  ScanStatusSchema,
  ScansResponseSchema,
} from "./schemas/disk-growth"

const HealthSchema = z.object({ ok: z.boolean() })

const errorResponses = {
  400: ApiErrorSchema,
  500: ApiErrorSchema,
}

export const contract = c.router(
  {
    getHealth: {
      method: "GET",
      path: toContractPath(ApiPath[`${API_BASE}/health`]),
      responses: {
        200: HealthSchema,
      },
    },
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
  },
  { pathPrefix: API_BASE }
)
