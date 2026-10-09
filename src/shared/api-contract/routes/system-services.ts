import { API_BASE, ApiPath, toContractPath } from "@shared/api-path"
import { ActionResponseSchema, ApiErrorSchema } from "../schemas/disk-growth"
import {
  ServiceEnabledBodySchema,
  ServiceTargetBodySchema,
  ServiceTargetQuerySchema,
  ServicesResponseSchema,
} from "../schemas/system-services"

const errorResponses = {
  400: ApiErrorSchema,
  500: ApiErrorSchema,
} as const

/** 系统服务操作：需要 root 的服务返回 403。 */
const serviceErrorResponses = {
  ...errorResponses,
  403: ApiErrorSchema,
} as const

export const systemServicesRoutes = {
  listSystemServices: {
    method: "GET",
    path: toContractPath(ApiPath[`${API_BASE}/system-services/services`]),
    responses: {
      200: ServicesResponseSchema,
      ...errorResponses,
    },
  },
  // 启动：把服务置为运行，幂等，用 PUT。
  startSystemService: {
    method: "PUT",
    path: toContractPath(ApiPath[`${API_BASE}/system-services/run`]),
    body: ServiceTargetBodySchema,
    responses: {
      202: ActionResponseSchema,
      ...serviceErrorResponses,
    },
  },
  // 停止：去掉运行状态，幂等，用 DELETE + query。
  stopSystemService: {
    method: "DELETE",
    path: toContractPath(ApiPath[`${API_BASE}/system-services/run`]),
    query: ServiceTargetQuerySchema,
    responses: {
      202: ActionResponseSchema,
      ...serviceErrorResponses,
    },
  },
  // 重启：修改已有运行实例的复杂动作，用 POST。
  restartSystemService: {
    method: "POST",
    path: toContractPath(ApiPath[`${API_BASE}/system-services/restart`]),
    body: ServiceTargetBodySchema,
    responses: {
      202: ActionResponseSchema,
      ...serviceErrorResponses,
    },
  },
  // 加载：把 plist bootstrap 进域，幂等，用 PUT。
  loadSystemService: {
    method: "PUT",
    path: toContractPath(ApiPath[`${API_BASE}/system-services/loaded`]),
    body: ServiceTargetBodySchema,
    responses: {
      202: ActionResponseSchema,
      ...serviceErrorResponses,
    },
  },
  // 卸载：bootout 并把 plist 移入废纸篓（移除安装），幂等，用 DELETE。
  uninstallSystemService: {
    method: "DELETE",
    path: toContractPath(ApiPath[`${API_BASE}/system-services/service`]),
    query: ServiceTargetQuerySchema,
    responses: {
      202: ActionResponseSchema,
      ...serviceErrorResponses,
    },
  },
  // 禁用/启用：只改 plist 之外的 launchd 开关，属局部更新，用 PATCH。
  setSystemServiceEnabled: {
    method: "PATCH",
    path: toContractPath(ApiPath[`${API_BASE}/system-services/service`]),
    body: ServiceEnabledBodySchema,
    responses: {
      202: ActionResponseSchema,
      ...serviceErrorResponses,
    },
  },
  revealSystemService: {
    method: "POST",
    path: toContractPath(ApiPath[`${API_BASE}/system-services/reveal`]),
    body: ServiceTargetBodySchema,
    responses: {
      202: ActionResponseSchema,
      ...serviceErrorResponses,
    },
  },
} as const
