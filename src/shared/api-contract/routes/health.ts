import { API_BASE, ApiPath, toContractPath } from "@shared/api-path"
import { HealthSchema } from "../schemas/health"

export const healthRoutes = {
  getHealth: {
    method: "GET",
    path: toContractPath(ApiPath[`${API_BASE}/health`]),
    responses: {
      200: HealthSchema,
    },
  },
} as const
