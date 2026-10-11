import { ApiPath, toContractPath } from "@shared/api-path"
import { c } from "../init"
import {
  CaddyRuleIdPathParamsSchema,
  CaddyRuleImportResultSchema,
  CaddyRuleInputSchema,
  CaddyRuleSchema,
  CaddyRulesResponseSchema,
  CaddyStatusSchema,
} from "../schemas/caddy"
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
  // 读取受管规则、文件里未接管的规则与应用前的预览；只读。
  getCaddyRules: {
    method: "GET",
    path: toContractPath(ApiPath.caddyRules),
    responses: {
      200: CaddyRulesResponseSchema,
      ...errorResponses,
    },
  },
  // 新增规则只写数据库，改配置文件要另行应用。
  createCaddyRule: {
    method: "POST",
    path: toContractPath(ApiPath.caddyRules),
    body: CaddyRuleInputSchema,
    responses: {
      201: CaddyRuleSchema,
      ...errorResponses,
      409: ApiErrorSchema,
    },
  },
  updateCaddyRule: {
    method: "PATCH",
    path: toContractPath(ApiPath.caddyRule),
    pathParams: CaddyRuleIdPathParamsSchema,
    body: CaddyRuleInputSchema,
    responses: {
      200: CaddyRuleSchema,
      ...errorResponses,
      409: ApiErrorSchema,
    },
  },
  deleteCaddyRule: {
    method: "DELETE",
    path: toContractPath(ApiPath.caddyRule),
    pathParams: CaddyRuleIdPathParamsSchema,
    responses: { 204: null, ...errorResponses },
  },
  // 把文件里识别到、尚未接管的规则一次性纳入管理；只写数据库。
  importCaddyRules: {
    method: "POST",
    path: toContractPath(ApiPath.caddyRulesImport),
    body: c.noBody(),
    responses: {
      200: CaddyRuleImportResultSchema,
      ...errorResponses,
      409: ApiErrorSchema,
    },
  },
} as const
