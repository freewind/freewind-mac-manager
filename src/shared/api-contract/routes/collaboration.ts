import { ApiPath, toContractPath } from "@shared/api-path"
import {
  CollaborationCommentListSchema,
  CollaborationCommentPathSchema,
  CollaborationCommentResponseSchema,
  CollaborationCreateThreadSchema,
  CollaborationCreateTopicSchema,
  CollaborationEditCommentSchema,
  CollaborationReorderSchema,
  CollaborationSearchQuerySchema,
  CollaborationSearchResultSchema,
  CollaborationSendCommentSchema,
  CollaborationThreadDetailSchema,
  CollaborationThreadListSchema,
  CollaborationThreadPathSchema,
  CollaborationTopicDetailSchema,
  CollaborationTopicListSchema,
  CollaborationTopicPathSchema,
  CollaborationUpdateThreadSchema,
  CollaborationUpdateTopicSchema,
} from "../schemas/collaboration"
import { ApiErrorSchema, TaskRequestIdHeadersSchema } from "../schemas/common"

/** 错误状态显式声明：只允许 PublicErrorStatus 与鉴权失败，不允许 429。 */
const errorResponses = {
  400: ApiErrorSchema,
  401: ApiErrorSchema,
  403: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  500: ApiErrorSchema,
} as const

/**
 * 协作契约路由。
 *
 * Thread / Comment 一律挂在 Topic 之下（path 带 topicId），
 * 这样「跨 Topic 的 id」能在归属校验里直接判掉，不依赖额外查询。
 * 集合上的排序用 PATCH，避免与 GET 同路径同方法冲突。
 */
export const collaborationRoutes = {
  listCollaborationTopics: {
    method: "GET",
    path: toContractPath(ApiPath.collaborationTopics),
    responses: {
      200: CollaborationTopicListSchema,
      ...errorResponses,
    },
  },
  createCollaborationTopic: {
    method: "POST",
    path: toContractPath(ApiPath.collaborationTopics),
    body: CollaborationCreateTopicSchema,
    responses: {
      201: CollaborationTopicDetailSchema,
      ...errorResponses,
    },
  },
  reorderCollaborationTopics: {
    method: "PATCH",
    path: toContractPath(ApiPath.collaborationTopics),
    body: CollaborationReorderSchema,
    responses: {
      200: CollaborationTopicListSchema,
      ...errorResponses,
    },
  },
  getCollaborationTopic: {
    method: "GET",
    path: toContractPath(ApiPath.collaborationTopic),
    pathParams: CollaborationTopicPathSchema,
    responses: {
      200: CollaborationTopicDetailSchema,
      ...errorResponses,
    },
  },
  updateCollaborationTopic: {
    method: "PATCH",
    path: toContractPath(ApiPath.collaborationTopic),
    pathParams: CollaborationTopicPathSchema,
    body: CollaborationUpdateTopicSchema,
    responses: {
      200: CollaborationTopicDetailSchema,
      ...errorResponses,
    },
  },
  deleteCollaborationTopic: {
    method: "DELETE",
    path: toContractPath(ApiPath.collaborationTopic),
    pathParams: CollaborationTopicPathSchema,
    responses: {
      204: null,
      ...errorResponses,
    },
  },
  listCollaborationThreads: {
    method: "GET",
    path: toContractPath(ApiPath.collaborationThreads),
    pathParams: CollaborationTopicPathSchema,
    responses: {
      200: CollaborationThreadListSchema,
      ...errorResponses,
    },
  },
  createCollaborationThread: {
    method: "POST",
    path: toContractPath(ApiPath.collaborationThreads),
    pathParams: CollaborationTopicPathSchema,
    body: CollaborationCreateThreadSchema,
    responses: {
      201: CollaborationThreadDetailSchema,
      ...errorResponses,
    },
  },
  reorderCollaborationThreads: {
    method: "PATCH",
    path: toContractPath(ApiPath.collaborationThreads),
    pathParams: CollaborationTopicPathSchema,
    body: CollaborationReorderSchema,
    responses: {
      200: CollaborationThreadListSchema,
      ...errorResponses,
    },
  },
  getCollaborationThread: {
    method: "GET",
    path: toContractPath(ApiPath.collaborationThread),
    pathParams: CollaborationThreadPathSchema,
    responses: {
      200: CollaborationThreadDetailSchema,
      ...errorResponses,
    },
  },
  updateCollaborationThread: {
    method: "PATCH",
    path: toContractPath(ApiPath.collaborationThread),
    pathParams: CollaborationThreadPathSchema,
    body: CollaborationUpdateThreadSchema,
    responses: {
      200: CollaborationThreadDetailSchema,
      ...errorResponses,
    },
  },
  deleteCollaborationThread: {
    method: "DELETE",
    path: toContractPath(ApiPath.collaborationThread),
    pathParams: CollaborationThreadPathSchema,
    responses: {
      204: null,
      ...errorResponses,
    },
  },
  listCollaborationComments: {
    method: "GET",
    path: toContractPath(ApiPath.collaborationComments),
    pathParams: CollaborationThreadPathSchema,
    responses: {
      200: CollaborationCommentListSchema,
      ...errorResponses,
    },
  },
  sendCollaborationComment: {
    method: "POST",
    path: toContractPath(ApiPath.collaborationComments),
    pathParams: CollaborationThreadPathSchema,
    /** 请求标识必填：同一标识重复提交必须只落一条消息。 */
    headers: TaskRequestIdHeadersSchema,
    body: CollaborationSendCommentSchema,
    responses: {
      /** 201 = 新建；200 = 同一请求标识重复提交，返回原消息。 */
      200: CollaborationCommentResponseSchema,
      201: CollaborationCommentResponseSchema,
      ...errorResponses,
    },
  },
  updateCollaborationComment: {
    method: "PUT",
    path: toContractPath(ApiPath.collaborationComment),
    pathParams: CollaborationCommentPathSchema,
    body: CollaborationEditCommentSchema,
    responses: {
      200: CollaborationCommentResponseSchema,
      ...errorResponses,
    },
  },
  deleteCollaborationComment: {
    method: "DELETE",
    path: toContractPath(ApiPath.collaborationComment),
    pathParams: CollaborationCommentPathSchema,
    responses: {
      204: null,
      ...errorResponses,
    },
  },
  searchCollaboration: {
    method: "GET",
    path: toContractPath(ApiPath.collaborationSearch),
    query: CollaborationSearchQuerySchema,
    responses: {
      200: CollaborationSearchResultSchema,
      ...errorResponses,
    },
  },
} as const
