import { ApiPath, toContractPath } from "@shared/api-path"
import { ActionResponseSchema, ApiErrorSchema } from "../schemas/common"
import {
  FrpConfigInputSchema,
  FrpConfigSchema,
  FrpProbeBodySchema,
  FrpProbeSchema,
} from "../schemas/frp"

const errorResponses = {
  400: ApiErrorSchema,
  500: ApiErrorSchema,
} as const

export const frpRoutes = {
  // 读取 frpc 配置文件，并补上 launchd 里的运行态。
  getFrpConfig: {
    method: "GET",
    path: toContractPath(ApiPath.frpConfig),
    responses: {
      200: FrpConfigSchema,
      ...errorResponses,
    },
  },
  // 保存：整份配置替换配置文件内容，幂等，用 PUT。
  saveFrpConfig: {
    method: "PUT",
    path: toContractPath(ApiPath.frpConfig),
    body: FrpConfigInputSchema,
    responses: {
      200: ActionResponseSchema,
      ...errorResponses,
    },
  },
  // 探测：由服务端发起一次 TCP 连接，浏览器无法直接建裸连接。
  probeFrpProxy: {
    method: "POST",
    path: toContractPath(ApiPath.frpProbe),
    body: FrpProbeBodySchema,
    responses: {
      200: FrpProbeSchema,
      ...errorResponses,
    },
  },
} as const
