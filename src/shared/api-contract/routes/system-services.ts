import { API_BASE, ApiPath, toContractPath } from "@shared/api-path"
import { ActionResponseSchema, ApiErrorSchema } from "../schemas/common"
import {
  ServiceEnabledBodySchema,
  ServiceTargetBodySchema,
  ServiceTargetQuerySchema,
  ServicesResponseSchema,
} from "../schemas/system-services"

const errorResponses = {
  400: ApiErrorSchema,
  500: ApiErrorSchema,
} as const

const serviceErrorResponses = {
  ...errorResponses,
  403: ApiErrorSchema,
} as const

export const systemServicesRoutes = {
  listSystemServices: {
    method: "GET",
    path: toContractPath(ApiPath[`${API_BASE}/system-services/services`]),
    responses: { 200: ServicesResponseSchema, ...errorResponses },
  },
  startSystemService: {
    method: "PUT",
    path: toContractPath(ApiPath[`${API_BASE}/system-services/run`]),
    body: ServiceTargetBodySchema,
    responses: { 200: ActionResponseSchema, ...serviceErrorResponses },
  },
  stopSystemService: {
    method: "DELETE",
    path: toContractPath(ApiPath[`${API_BASE}/system-services/run`]),
    query: ServiceTargetQuerySchema,
    responses: { 200: ActionResponseSchema, ...serviceErrorResponses },
  },
  restartSystemService: {
    method: "POST",
    path: toContractPath(ApiPath[`${API_BASE}/system-services/restart`]),
    body: ServiceTargetBodySchema,
    responses: { 200: ActionResponseSchema, ...serviceErrorResponses },
  },
  loadSystemService: {
    method: "PUT",
    path: toContractPath(ApiPath[`${API_BASE}/system-services/loaded`]),
    body: ServiceTargetBodySchema,
    responses: { 200: ActionResponseSchema, ...serviceErrorResponses },
  },
  uninstallSystemService: {
    method: "DELETE",
    path: toContractPath(ApiPath[`${API_BASE}/system-services/service`]),
    query: ServiceTargetQuerySchema,
    responses: { 200: ActionResponseSchema, ...serviceErrorResponses },
  },
  setSystemServiceEnabled: {
    method: "PATCH",
    path: toContractPath(ApiPath[`${API_BASE}/system-services/service`]),
    body: ServiceEnabledBodySchema,
    responses: { 200: ActionResponseSchema, ...serviceErrorResponses },
  },
  revealSystemService: {
    method: "POST",
    path: toContractPath(ApiPath[`${API_BASE}/system-services/reveal`]),
    body: ServiceTargetBodySchema,
    responses: { 200: ActionResponseSchema, ...serviceErrorResponses },
  },
} as const
