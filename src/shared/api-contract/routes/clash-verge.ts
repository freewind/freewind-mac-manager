import { ApiPath, toContractPath } from "@shared/api-path"
import {
  ClashMergeConfigSchema,
  ClashVergeConnectionsResponseSchema,
  ClashVergeGeositeSchema,
  ClashVergeProfileFileQuerySchema,
  ClashVergeProfileFileSchema,
  ClashVergeProfilesResponseSchema,
  ClashVergeProxiesResponseSchema,
  ClashVergeStatusSchema,
  MergeClashProfilesBodySchema,
  SaveClashMergeConfigBodySchema,
  SetClashVergeCurrentProfileBodySchema,
} from "../schemas/clash-verge"
import { ActionResponseSchema, ApiErrorSchema } from "../schemas/common"

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
  // 单个订阅的配置文件原文：只读，uid 由服务端在清单里查证。
  getClashVergeProfileFile: {
    method: "GET",
    path: toContractPath(ApiPath.clashVergeProfileFile),
    query: ClashVergeProfileFileQuerySchema,
    responses: {
      200: ClashVergeProfileFileSchema,
      400: ApiErrorSchema,
      404: ApiErrorSchema,
      ...readErrors,
    },
  },
  // geosite 数据库：只读本地 geosite.dat，用于查看分类与域名条目。
  getClashVergeGeosite: {
    method: "GET",
    path: toContractPath(ApiPath.clashVergeGeosite),
    responses: {
      200: ClashVergeGeositeSchema,
      404: ApiErrorSchema,
      ...readErrors,
    },
  },
  // 切换订阅：改 current 并重启 Clash Verge 重新生成配置；409 表示已在该订阅或拒绝改写。
  setClashVergeCurrentProfile: {
    method: "PUT",
    path: toContractPath(ApiPath.clashVergeProfileCurrent),
    body: SetClashVergeCurrentProfileBodySchema,
    responses: {
      200: ActionResponseSchema,
      400: ApiErrorSchema,
      401: ApiErrorSchema,
      404: ApiErrorSchema,
      409: ApiErrorSchema,
      429: ApiErrorSchema,
      500: ApiErrorSchema,
    },
  },
  // 合并订阅设置：读写应用自己的库，不碰 Clash Verge 配置文件。
  getClashMergeConfig: {
    method: "GET",
    path: toContractPath(ApiPath.clashMergeConfig),
    responses: { 200: ClashMergeConfigSchema, ...readErrors },
  },
  saveClashMergeConfig: {
    method: "PUT",
    path: toContractPath(ApiPath.clashMergeConfig),
    body: SaveClashMergeConfigBodySchema,
    responses: {
      200: ActionResponseSchema,
      400: ApiErrorSchema,
      401: ApiErrorSchema,
      429: ApiErrorSchema,
      500: ApiErrorSchema,
    },
  },
  // 生成合并配置：读选中的订阅、按分组规则重写一份本地配置并登记。
  mergeClashProfiles: {
    method: "POST",
    path: toContractPath(ApiPath.clashMergeProfiles),
    body: MergeClashProfilesBodySchema,
    responses: {
      200: ActionResponseSchema,
      400: ApiErrorSchema,
      401: ApiErrorSchema,
      404: ApiErrorSchema,
      409: ApiErrorSchema,
      429: ApiErrorSchema,
      500: ApiErrorSchema,
    },
  },
} as const
