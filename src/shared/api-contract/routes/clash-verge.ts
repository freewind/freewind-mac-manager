import { ApiPath, toContractPath } from "@shared/api-path"
import {
  ClashVergeConnectionsResponseSchema,
  ClashVergeProxiesResponseSchema,
  ClashVergeStatusSchema,
} from "../schemas/clash-verge"
import { ApiErrorSchema } from "../schemas/common"

const readErrors = {
  500: ApiErrorSchema,
} as const

export const clashVergeRoutes = {
  getClashVergeStatus: {
    method: "GET",
    path: toContractPath(ApiPath.clashVergeStatus),
    responses: { 200: ClashVergeStatusSchema, ...readErrors },
  },
  getClashVergeProxies: {
    method: "GET",
    path: toContractPath(ApiPath.clashVergeProxies),
    responses: { 200: ClashVergeProxiesResponseSchema, ...readErrors },
  },
  getClashVergeConnections: {
    method: "GET",
    path: toContractPath(ApiPath.clashVergeConnections),
    responses: { 200: ClashVergeConnectionsResponseSchema, ...readErrors },
  },
} as const
