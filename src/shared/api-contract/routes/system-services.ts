import { ApiPath, toContractPath } from "@shared/api-path"
import {
  ActionResponseSchema,
  ApiErrorSchema,
  TaskAcceptedSchema,
  TaskRequestIdHeadersSchema,
} from "../schemas/common"
import {
  ServiceEnabledBodySchema,
  ServicesResponseSchema,
  ServiceTargetBodySchema,
  ServiceTargetQuerySchema,
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
    headers: TaskRequestIdHeadersSchema,
    responses: {
      200: ActionResponseSchema,
      202: TaskAcceptedSchema,
      409: ApiErrorSchema,
      ...serviceErrorResponses,
    },
  },
  stopSystemService: {
    method: "DELETE",
    path: toContractPath(ApiPath.systemServicesRun),
    query: ServiceTargetQuerySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: {
      200: ActionResponseSchema,
      202: TaskAcceptedSchema,
      409: ApiErrorSchema,
      ...serviceErrorResponses,
    },
  },
  restartSystemService: {
    method: "POST",
    path: toContractPath(ApiPath.systemServicesRestart),
    body: ServiceTargetBodySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: {
      200: ActionResponseSchema,
      202: TaskAcceptedSchema,
      409: ApiErrorSchema,
      ...serviceErrorResponses,
    },
  },
  loadSystemService: {
    method: "PUT",
    path: toContractPath(ApiPath.systemServicesLoaded),
    body: ServiceTargetBodySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: {
      200: ActionResponseSchema,
      202: TaskAcceptedSchema,
      409: ApiErrorSchema,
      ...serviceErrorResponses,
    },
  },
  uninstallSystemService: {
    method: "DELETE",
    path: toContractPath(ApiPath.systemService),
    query: ServiceTargetQuerySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: {
      200: ActionResponseSchema,
      202: TaskAcceptedSchema,
      409: ApiErrorSchema,
      ...serviceErrorResponses,
    },
  },
  setSystemServiceEnabled: {
    method: "PATCH",
    path: toContractPath(ApiPath.systemService),
    body: ServiceEnabledBodySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: {
      200: ActionResponseSchema,
      202: TaskAcceptedSchema,
      409: ApiErrorSchema,
      ...serviceErrorResponses,
    },
  },
  revealSystemService: {
    method: "POST",
    path: toContractPath(ApiPath.systemServicesReveal),
    body: ServiceTargetBodySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: {
      200: ActionResponseSchema,
      202: TaskAcceptedSchema,
      409: ApiErrorSchema,
      ...serviceErrorResponses,
    },
  },
} as const
