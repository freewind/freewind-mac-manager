import { ApiPath, toContractPath } from "@shared/api-path"
import { ApiErrorSchema } from "../schemas/common"
import { HardwareOverviewSchema } from "../schemas/hardware"

export const hardwareRoutes = {
  hardwareOverview: {
    method: "GET",
    path: toContractPath(ApiPath.hardwareOverview),
    responses: {
      200: HardwareOverviewSchema,
      400: ApiErrorSchema,
      500: ApiErrorSchema,
    },
  },
} as const
