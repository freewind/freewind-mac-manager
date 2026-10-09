import { ApiPath, toContractPath } from "@shared/api-path"
import { ApiErrorSchema } from "../schemas/common"
import {
  KillPortProcessesBodySchema,
  KillPortProcessesResponseSchema,
  PortBindingsResponseSchema,
} from "../schemas/ports"

const errorResponses = {
  400: ApiErrorSchema,
  500: ApiErrorSchema,
} as const

export const portsRoutes = {
  listPortBindings: {
    method: "GET",
    path: toContractPath(ApiPath.portsBindings),
    responses: {
      200: PortBindingsResponseSchema,
      ...errorResponses,
    },
  },
  killPortProcesses: {
    method: "POST",
    path: toContractPath(ApiPath.portsProcessesKill),
    body: KillPortProcessesBodySchema,
    responses: {
      200: KillPortProcessesResponseSchema,
      ...errorResponses,
    },
  },
} as const
