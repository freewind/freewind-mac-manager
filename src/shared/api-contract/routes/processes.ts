import { ApiPath, toContractPath } from "@shared/api-path"
import {
  ApiErrorSchema,
  KillProcessesBodySchema,
  KillProcessesResponseSchema,
} from "../schemas/common"
import { ProcessListResponseSchema } from "../schemas/processes"

const errorResponses = {
  400: ApiErrorSchema,
  500: ApiErrorSchema,
} as const

export const processesRoutes = {
  listProcesses: {
    method: "GET",
    path: toContractPath(ApiPath.processes),
    responses: {
      200: ProcessListResponseSchema,
      ...errorResponses,
    },
  },
  // 结束进程是不可逆动作，按语义用 POST；body 与流量监控的结束进程同形。
  killProcesses: {
    method: "POST",
    path: toContractPath(ApiPath.processesKill),
    body: KillProcessesBodySchema,
    responses: {
      200: KillProcessesResponseSchema,
      ...errorResponses,
    },
  },
} as const
