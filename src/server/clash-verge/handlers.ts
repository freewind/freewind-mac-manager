import { clashVergeContract } from "@shared/api-contract/routes/clash-verge"
import {
  getClashVergeConnections,
  getClashVergeProxies,
  getClashVergeStatus,
} from "./service"

export { clashVergeContract }

export const clashVergeRouter = {
  getClashVergeStatus: async () => ({
    status: 200 as const,
    body: await getClashVergeStatus(),
  }),
  getClashVergeProxies: async () => ({
    status: 200 as const,
    body: await getClashVergeProxies(),
  }),
  getClashVergeConnections: async () => ({
    status: 200 as const,
    body: await getClashVergeConnections(),
  }),
}
