import { healthRoutes } from "@shared/api-contract/routes/health"
import { initServer } from "@ts-rest/express"
import { getHealth } from "./health.get"

const s = initServer()

export const healthContract = healthRoutes
export const healthRouter = s.router(healthContract, { getHealth })
