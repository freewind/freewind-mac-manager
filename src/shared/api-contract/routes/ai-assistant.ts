import { ApiPath, toContractPath } from "@shared/api-path"
import {
  AiAssistantSessionListSchema,
  AiAssistantSessionPathSchema,
  AiAssistantSettingsMutationSchema,
  AiAssistantSettingsResponseSchema,
} from "../schemas/ai-assistant"
import { ApiErrorSchema } from "../schemas/common"

const errorResponses = {
  400: ApiErrorSchema,
  403: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  500: ApiErrorSchema,
} as const

/** SSE 流式端点（aiAssistantMessage）有意不进契约，见 handlers 的独立挂载。 */
export const aiAssistantRoutes = {
  getAiAssistantSettings: {
    method: "GET",
    path: toContractPath(ApiPath.aiAssistantSettings),
    responses: { 200: AiAssistantSettingsResponseSchema, ...errorResponses },
  },
  saveAiAssistantSettings: {
    method: "PUT",
    path: toContractPath(ApiPath.aiAssistantSettings),
    body: AiAssistantSettingsMutationSchema,
    responses: { 200: AiAssistantSettingsResponseSchema, ...errorResponses },
  },
  listAiAssistantSessions: {
    method: "GET",
    path: toContractPath(ApiPath.aiAssistantSessions),
    responses: { 200: AiAssistantSessionListSchema, ...errorResponses },
  },
  clearAiAssistantSession: {
    method: "DELETE",
    path: toContractPath(ApiPath.aiAssistantSession),
    pathParams: AiAssistantSessionPathSchema,
    responses: { 204: null, ...errorResponses },
  },
} as const
