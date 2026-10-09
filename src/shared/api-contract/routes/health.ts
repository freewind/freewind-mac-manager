import { ApiPath, toContractPath } from "@shared/api-path"
import { HealthSchema } from "../schemas/health"

export const healthRoutes = {
  getHealth: {
    method: "GET",
    path: toContractPath(ApiPath.health),
    responses: {
      200: HealthSchema,
    },
  },
} as const
