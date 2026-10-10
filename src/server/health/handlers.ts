import { contract } from "@shared/api-contract"
import { initServer } from "@ts-rest/express"
import { getHealth } from "./health.get"

const s = initServer()

/** 与客户端同源：取共享 contract 里已带 /api 前缀的探活路由。 */
export const healthContract = { getHealth: contract.getHealth }
export const healthRouter = s.router(healthContract, { getHealth })
