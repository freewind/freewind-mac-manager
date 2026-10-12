import { ApiPath, toContractPath } from "@shared/api-path"
import { ApiErrorSchema } from "../schemas/common"
import {
  DashboardOverviewSchema,
  PortsResponseSchema,
  ProcessesQuerySchema,
  ProcessesResponseSchema,
} from "../schemas/dashboard"

const errorResponses = {
  400: ApiErrorSchema,
  500: ApiErrorSchema,
} as const

export const dashboardRoutes = {
  dashboardOverview: {
    method: "GET",
    path: toContractPath(ApiPath.dashboardOverview),
    responses: {
      200: DashboardOverviewSchema,
      ...errorResponses,
    },
  },
  listTopProcesses: {
    method: "GET",
    path: toContractPath(ApiPath.dashboardProcesses),
    query: ProcessesQuerySchema,
    responses: {
      200: ProcessesResponseSchema,
      ...errorResponses,
    },
  },
  listListeningPorts: {
    method: "GET",
    path: toContractPath(ApiPath.dashboardPorts),
    responses: {
      200: PortsResponseSchema,
      ...errorResponses,
    },
  },
} as const
