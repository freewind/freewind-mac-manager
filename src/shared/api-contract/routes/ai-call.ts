import { ApiPath, toContractPath } from "@shared/api-path"
import { c } from "../init"
import {
  AiCallExecutionSchema,
  AiCallSessionCreateSchema,
  AiCallSessionDetailSchema,
  AiCallSessionListSchema,
  AiCallSessionPathSchema,
  AiCallSessionUpdateSchema,
  AiCallTranscribeRequestSchema,
  AiCallTranscribeResponseSchema,
} from "../schemas/ai-call"
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
 * AI 通话契约。
 *
 * 通话是线性的：一个会话里只有来回的消息，没有线程分支，也不需要未读数。
 * 对话本身是 SSE 传输例外，见 handlers 里的独立挂载。
 */
export const aiCallRoutes = {
  /** 语音识别：本机 sherpa-onnx 整句识别，不依赖外网。 */
  transcribeAiCallAudio: {
    method: "POST",
    path: toContractPath(ApiPath.aiCallTranscribe),
    body: AiCallTranscribeRequestSchema,
    responses: { 200: AiCallTranscribeResponseSchema, ...errorResponses },
  },
  listAiCallSessions: {
    method: "GET",
    path: toContractPath(ApiPath.aiCallSessions),
    responses: { 200: AiCallSessionListSchema, ...errorResponses },
  },
  createAiCallSession: {
    method: "POST",
    path: toContractPath(ApiPath.aiCallSessions),
    body: AiCallSessionCreateSchema,
    responses: { 201: AiCallSessionDetailSchema, ...errorResponses },
  },
  getAiCallSession: {
    method: "GET",
    path: toContractPath(ApiPath.aiCallSession),
    pathParams: AiCallSessionPathSchema,
    responses: { 200: AiCallSessionDetailSchema, ...errorResponses },
  },
  updateAiCallSession: {
    method: "PATCH",
    path: toContractPath(ApiPath.aiCallSession),
    pathParams: AiCallSessionPathSchema,
    body: AiCallSessionUpdateSchema,
    responses: { 200: AiCallSessionDetailSchema, ...errorResponses },
  },
  deleteAiCallSession: {
    method: "DELETE",
    path: toContractPath(ApiPath.aiCallSession),
    pathParams: AiCallSessionPathSchema,
    responses: { 204: null, ...errorResponses },
  },
  /** 当前执行：没有执行时 execution 为 null。 */
  getAiCallExecution: {
    method: "GET",
    path: toContractPath(ApiPath.aiCallExecution),
    pathParams: AiCallSessionPathSchema,
    responses: { 200: AiCallExecutionSchema, ...errorResponses },
  },
  /** 挂断：只标结束时间与最后活跃时间，消息历史全部保留。 */
  finishAiCallSession: {
    method: "POST",
    path: toContractPath(ApiPath.aiCallFinish),
    pathParams: AiCallSessionPathSchema,
    body: c.noBody(),
    responses: { 200: AiCallSessionDetailSchema, ...errorResponses },
  },
  /** 打断后停掉当前执行：这是取消执行的唯一入口。 */
  stopAiCallExecution: {
    method: "POST",
    path: toContractPath(ApiPath.aiCallExecutionStop),
    pathParams: AiCallSessionPathSchema,
    body: c.noBody(),
    responses: { 200: AiCallExecutionSchema, ...errorResponses },
  },
} as const
