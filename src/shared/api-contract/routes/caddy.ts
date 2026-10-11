import { ApiPath, toContractPath } from "@shared/api-path"
import { c } from "../init"
import {
  CaddyApplyInputSchema,
  CaddyApplyResultSchema,
  CaddyRuleIdPathParamsSchema,
  CaddyRuleImportResultSchema,
  CaddyRuleInputSchema,
  CaddyRuleSchema,
  CaddyRulesResponseSchema,
  CaddyStatusSchema,
  CaddyVersionIdPathParamsSchema,
  CaddyVersionListSchema,
} from "../schemas/caddy"
import {
  ApiErrorSchema,
  TaskAcceptedSchema,
  TaskRequestIdHeadersSchema,
} from "../schemas/common"

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
  // 应用：写文件、平滑加载并核实。请求标识由契约强制要求，
  // 网络重试不会变成第二次应用。
  applyCaddyConfig: {
    method: "POST",
    path: toContractPath(ApiPath.caddyApply),
    body: CaddyApplyInputSchema,
    headers: TaskRequestIdHeadersSchema,
    responses: {
      200: CaddyApplyResultSchema,
      202: TaskAcceptedSchema,
      ...errorResponses,
      409: ApiErrorSchema,
    },
  },
  // 历史版本列表：只读，供页面选择恢复目标。
  listCaddyVersions: {
    method: "GET",
    path: toContractPath(ApiPath.caddyVersions),
    responses: {
      200: CaddyVersionListSchema,
      ...errorResponses,
    },
  },
  // 恢复历史版本同样要写文件与重新加载，必须带请求标识。
  restoreCaddyVersion: {
    method: "POST",
    path: toContractPath(ApiPath.caddyVersionRestore),
    pathParams: CaddyVersionIdPathParamsSchema,
    body: c.noBody(),
    headers: TaskRequestIdHeadersSchema,
    responses: {
      200: CaddyApplyResultSchema,
      202: TaskAcceptedSchema,
      ...errorResponses,
      409: ApiErrorSchema,
    },
  },
} as const
