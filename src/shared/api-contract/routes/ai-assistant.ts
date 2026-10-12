import { ApiPath, toContractPath } from "@shared/api-path"
import { c } from "../init"
import {
  AiAssistantExecutionPathSchema,
  AiAssistantExecutionResponseSchema,
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

/**
 * SSE 端点有意不进契约：ts-rest 不支持 text/event-stream 的响应形态。
 * - `aiAssistantMessage`：提交一次执行并订阅（见 handlers 的独立挂载）；
 * - `aiAssistantExecutionEvents`：按执行标识重新订阅，不重发原指令。
 */
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
  /** 查询执行状态与所属会话历史：断线后据此确认执行是否已经完成。 */
  getAiAssistantExecution: {
    method: "GET",
    path: toContractPath(ApiPath.aiAssistantExecution),
    pathParams: AiAssistantExecutionPathSchema,
    responses: { 200: AiAssistantExecutionResponseSchema, ...errorResponses },
  },
  /** 显式停止：这是取消执行的唯一受控入口，断线不走这里。 */
  stopAiAssistantExecution: {
    method: "POST",
    path: toContractPath(ApiPath.aiAssistantExecutionStop),
    pathParams: AiAssistantExecutionPathSchema,
    body: c.noBody(),
    responses: { 200: AiAssistantExecutionResponseSchema, ...errorResponses },
  },
} as const
