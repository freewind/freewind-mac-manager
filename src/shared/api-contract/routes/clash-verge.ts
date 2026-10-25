import { ApiPath, toContractPath } from "@shared/api-path"
import {
  ClashVergeConnectionsResponseSchema,
  ClashVergeMergeFileSchema,
  ClashVergeProfilesResponseSchema,
  ClashVergeProxiesResponseSchema,
  ClashVergeStatusSchema,
  SaveClashVergeMergeBodySchema,
} from "../schemas/clash-verge"
import { ActionResponseSchema, ApiErrorSchema } from "../schemas/common"

const readErrors = {
  500: ApiErrorSchema,
} as const

/**
 * Merge 文件读写显式声明全部错误状态：401/429 来自认证与限流中间件，
 * 403 是符号链接或路径越界，404 是文件不存在，409 是占用等冲突，
 * 400 是入参与大小超限。
 */
const mergeErrorResponses = {
  400: ApiErrorSchema,
  401: ApiErrorSchema,
  403: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  429: ApiErrorSchema,
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
  // 订阅清单只读：Clash Verge 不对外提供订阅 API，内容来自 profiles.yaml。
  getClashVergeProfiles: {
    method: "GET",
    path: toContractPath(ApiPath.clashVergeProfiles),
    responses: {
      200: ClashVergeProfilesResponseSchema,
      404: ApiErrorSchema,
      ...readErrors,
    },
  },
  // 读全局 Merge（uid: Merge）：路径固定为 Clash Verge profiles/Merge.yaml，客户端不传路径。
  getClashVergeMergeFile: {
    method: "GET",
    path: toContractPath(ApiPath.clashVergeMergeFile),
    responses: { 200: ClashVergeMergeFileSchema, ...mergeErrorResponses },
  },
  // 保存：整份替换 Merge 内容，只落盘，不触发 Clash Verge 重载，不修改订阅专属 merge。
  saveClashVergeMergeFile: {
    method: "PUT",
    path: toContractPath(ApiPath.clashVergeMergeFile),
    body: SaveClashVergeMergeBodySchema,
    responses: {
      200: ActionResponseSchema,
      ...mergeErrorResponses,
    },
  },
} as const
