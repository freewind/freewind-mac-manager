import { ApiPath, toContractPath } from "@shared/api-path"
import { CaddyRulesResponseSchema, CaddyStatusSchema } from "../schemas/caddy"
import { ApiErrorSchema } from "../schemas/common"

const errorResponses = {
  400: ApiErrorSchema,
  403: ApiErrorSchema,
  404: ApiErrorSchema,
  500: ApiErrorSchema,
} as const

export const caddyRoutes = {
  // 读取 Caddy 进程、管理接口与配置文件的现状；只读，不产生副作用。
  getCaddyStatus: {
    method: "GET",
    path: toContractPath(ApiPath.caddyStatus),
    responses: {
      200: CaddyStatusSchema,
      ...errorResponses,
    },
  },
  // 读取配置文件里识别到的转发规则；无法识别的行只回数量与样本。
  getCaddyRules: {
    method: "GET",
    path: toContractPath(ApiPath.caddyRules),
    responses: {
      200: CaddyRulesResponseSchema,
      ...errorResponses,
    },
  },
} as const
