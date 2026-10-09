import { ApiPath, toContractPath } from "@shared/api-path"
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
    path: toContractPath(ApiPath.systemServices),
    responses: { 200: ServicesResponseSchema, ...errorResponses },
  },
  startSystemService: {
    method: "PUT",
    path: toContractPath(ApiPath.systemServicesRun),
    body: ServiceTargetBodySchema,
    responses: { 200: ActionResponseSchema, ...serviceErrorResponses },
  },
  stopSystemService: {
    method: "DELETE",
    path: toContractPath(ApiPath.systemServicesRun),
    query: ServiceTargetQuerySchema,
    responses: { 200: ActionResponseSchema, ...serviceErrorResponses },
  },
  restartSystemService: {
    method: "POST",
    path: toContractPath(ApiPath.systemServicesRestart),
    body: ServiceTargetBodySchema,
    responses: { 200: ActionResponseSchema, ...serviceErrorResponses },
  },
  loadSystemService: {
    method: "PUT",
    path: toContractPath(ApiPath.systemServicesLoaded),
    body: ServiceTargetBodySchema,
    responses: { 200: ActionResponseSchema, ...serviceErrorResponses },
  },
  uninstallSystemService: {
    method: "DELETE",
    path: toContractPath(ApiPath.systemService),
    query: ServiceTargetQuerySchema,
    responses: { 200: ActionResponseSchema, ...serviceErrorResponses },
  },
  setSystemServiceEnabled: {
    method: "PATCH",
    path: toContractPath(ApiPath.systemService),
    body: ServiceEnabledBodySchema,
    responses: { 200: ActionResponseSchema, ...serviceErrorResponses },
  },
  revealSystemService: {
    method: "POST",
    path: toContractPath(ApiPath.systemServicesReveal),
    body: ServiceTargetBodySchema,
    responses: { 200: ActionResponseSchema, ...serviceErrorResponses },
  },
} as const
