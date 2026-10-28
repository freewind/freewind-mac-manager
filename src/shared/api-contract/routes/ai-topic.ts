import { ApiPath, toContractPath } from "@shared/api-path"
import { c } from "../init"
import {
  AiTopicCreateSchema,
  AiTopicDetailSchema,
  AiTopicExecutionSchema,
  AiTopicListSchema,
  AiTopicPathSchema,
  AiTopicSettingsMutationSchema,
  AiTopicSettingsResponseSchema,
  AiTopicThreadCreateSchema,
  AiTopicThreadMessagesQuerySchema,
  AiTopicThreadMessagesSchema,
  AiTopicThreadPathSchema,
  AiTopicThreadResponseSchema,
  AiTopicThreadUpdateSchema,
  AiTopicUpdateSchema,
} from "../schemas/ai-topic"
import { ApiErrorSchema } from "../schemas/common"

const errorResponses = {
  400: ApiErrorSchema,
  401: ApiErrorSchema,
  403: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  500: ApiErrorSchema,
} as const

/**
 * AI 话题契约路由。
 *
 * 线程一律挂在话题之下（path 带 topicId），跨话题的线程 id 在归属校验里
 * 直接判掉。对话本身是 SSE 传输例外，见 handlers 的独立挂载。
 */
export const aiTopicRoutes = {
  /** 话题自己的设置：与 AI 助手设置完全独立，互不影响。 */
  getAiTopicSettings: {
    method: "GET",
    path: toContractPath(ApiPath.aiTopicSettings),
    responses: { 200: AiTopicSettingsResponseSchema, ...errorResponses },
  },
  saveAiTopicSettings: {
    method: "PUT",
    path: toContractPath(ApiPath.aiTopicSettings),
    body: AiTopicSettingsMutationSchema,
    responses: { 200: AiTopicSettingsResponseSchema, ...errorResponses },
  },
  listAiTopics: {
    method: "GET",
    path: toContractPath(ApiPath.aiTopics),
    responses: { 200: AiTopicListSchema, ...errorResponses },
  },
  createAiTopic: {
    method: "POST",
    path: toContractPath(ApiPath.aiTopics),
    body: AiTopicCreateSchema,
    responses: { 201: AiTopicDetailSchema, ...errorResponses },
  },
  getAiTopic: {
    method: "GET",
    path: toContractPath(ApiPath.aiTopic),
    pathParams: AiTopicPathSchema,
    responses: { 200: AiTopicDetailSchema, ...errorResponses },
  },
  updateAiTopic: {
    method: "PATCH",
    path: toContractPath(ApiPath.aiTopic),
    pathParams: AiTopicPathSchema,
    body: AiTopicUpdateSchema,
    responses: { 200: AiTopicDetailSchema, ...errorResponses },
  },
  deleteAiTopic: {
    method: "DELETE",
    path: toContractPath(ApiPath.aiTopic),
    pathParams: AiTopicPathSchema,
    responses: { 204: null, ...errorResponses },
  },
  createAiTopicThread: {
    method: "POST",
    path: toContractPath(ApiPath.aiTopicThreads),
    pathParams: AiTopicPathSchema,
    body: AiTopicThreadCreateSchema,
    responses: { 201: AiTopicThreadResponseSchema, ...errorResponses },
  },
  updateAiTopicThread: {
    method: "PATCH",
    path: toContractPath(ApiPath.aiTopicThread),
    pathParams: AiTopicThreadPathSchema,
    body: AiTopicThreadUpdateSchema,
    responses: { 200: AiTopicThreadResponseSchema, ...errorResponses },
  },
  deleteAiTopicThread: {
    method: "DELETE",
    path: toContractPath(ApiPath.aiTopicThread),
    pathParams: AiTopicThreadPathSchema,
    responses: { 204: null, ...errorResponses },
  },
  listAiTopicThreadMessages: {
    method: "GET",
    path: toContractPath(ApiPath.aiTopicThreadMessages),
    pathParams: AiTopicThreadPathSchema,
    query: AiTopicThreadMessagesQuerySchema,
    responses: { 200: AiTopicThreadMessagesSchema, ...errorResponses },
  },
  /** 当前执行：没有执行时 409。停止是取消执行的唯一入口。 */
  stopAiTopicExecution: {
    method: "POST",
    path: toContractPath(ApiPath.aiTopicExecutionStop),
    pathParams: AiTopicPathSchema,
    body: c.noBody(),
    responses: { 200: AiTopicExecutionSchema, ...errorResponses },
  },
} as const
