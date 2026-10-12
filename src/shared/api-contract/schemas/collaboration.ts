import { z } from "zod"

/**
 * 协作数据（Topic / Thread / Comment）的形状来源。
 *
 * 字段以 freewind-agent-hub 的源码（src/shared/hub-data.ts）与 data/db.json 为准：
 * - 源仓库没有「隐藏」标记，代码与数据里都不存在 isHidden，所以这里不定义它；
 * - Topic 的真实额外字段是 agentNotifyUrl / agentNotifyEnabled；
 * - 未读数、threadCount、link 都是派生值，只定义形状，不落库。
 */

/** 源项目 db.json 的评论形状（内嵌在 thread 里）。 */
export const AgentHubCommentSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "agent"]),
  body: z.string(),
  createdAt: z.string().min(1),
  /** 用户消息被编辑后才有；缺失表示从未编辑。 */
  updatedAt: z.string().min(1).optional(),
  /** 用户消息被 Agent 读取后置 true；源数据里可能缺省。 */
  readByAgent: z.boolean().optional(),
  /** Agent 展示名，例如「LongCat-2.0 (sub)」。 */
  authorAgent: z.string().optional(),
})

export const AgentHubThreadSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  createdAt: z.string().min(1),
  completedAt: z.string().min(1).optional(),
  createdByAgent: z.string().optional(),
  /** 上次读到的最后一条 comment id；null 或缺省都表示从未读过。 */
  userLastReadCommentId: z.string().nullable().optional(),
  comments: z.array(AgentHubCommentSchema),
})

export const AgentHubTopicSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  createdAt: z.string().min(1),
  completedAt: z.string().min(1).optional(),
  createdByAgent: z.string().optional(),
  agentNotifyUrl: z.string().optional(),
  agentNotifyEnabled: z.boolean().optional(),
  threads: z.array(AgentHubThreadSchema),
})

/** 源项目 db.json 的完整树形形状：数组顺序即显示顺序。 */
export const AgentHubDataSchema = z.object({
  updatedAt: z.string().optional(),
  topics: z.array(AgentHubTopicSchema),
})

export type AgentHubComment = z.infer<typeof AgentHubCommentSchema>
export type AgentHubThread = z.infer<typeof AgentHubThreadSchema>
export type AgentHubTopic = z.infer<typeof AgentHubTopicSchema>
export type AgentHubData = z.infer<typeof AgentHubDataSchema>

/**
 * 存储记录形状：树形结构摊平后补归属 id，并用显式 position 保存源项目的数组顺序。
 * 可选字段在库里统一落成 null，读取时不会出现 undefined。
 */
export const CollaborationCommentSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  role: z.enum(["user", "agent"]),
  body: z.string(),
  createdAt: z.string().min(1),
  updatedAt: z.string().nullable(),
  readByAgent: z.boolean().nullable(),
  authorAgent: z.string().nullable(),
  position: z.number().int().nonnegative(),
})

export const CollaborationThreadRecordSchema = z.object({
  id: z.string().min(1),
  topicId: z.string().min(1),
  title: z.string(),
  createdAt: z.string().min(1),
  completedAt: z.string().nullable(),
  createdByAgent: z.string().nullable(),
  userLastReadCommentId: z.string().nullable(),
  position: z.number().int().nonnegative(),
})

export const CollaborationTopicRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  createdAt: z.string().min(1),
  completedAt: z.string().nullable(),
  createdByAgent: z.string().nullable(),
  agentNotifyUrl: z.string().nullable(),
  agentNotifyEnabled: z.boolean().nullable(),
  position: z.number().int().nonnegative(),
})

/** 读取形：记录 + 现算派生字段（不落库）。 */
export const CollaborationThreadSchema = CollaborationThreadRecordSchema.extend(
  {
    /** 已读位置之后、role 为 agent 的评论数；marker 失效时按 0 处理。 */
    userUnreadCount: z.number().int().nonnegative(),
    /** 页内跳转 Markdown，例如 [标题](#thread:thread-x)。 */
    link: z.string(),
  }
)

export const CollaborationTopicSchema = CollaborationTopicRecordSchema.extend({
  threadCount: z.number().int().nonnegative(),
  userUnreadCount: z.number().int().nonnegative(),
})

export type CollaborationComment = z.infer<typeof CollaborationCommentSchema>
export type CollaborationThreadRecord = z.infer<
  typeof CollaborationThreadRecordSchema
>
export type CollaborationTopicRecord = z.infer<
  typeof CollaborationTopicRecordSchema
>
export type CollaborationThread = z.infer<typeof CollaborationThreadSchema>
export type CollaborationTopic = z.infer<typeof CollaborationTopicSchema>

/** 路径参数：Thread / Comment 一律挂在 Topic 之下，便于校验归属。 */
export const CollaborationTopicPathSchema = z.object({
  topicId: z.string().min(1).max(200),
})

export const CollaborationThreadPathSchema = z.object({
  topicId: z.string().min(1).max(200),
  threadId: z.string().min(1).max(200),
})

export const CollaborationCommentPathSchema = z.object({
  topicId: z.string().min(1).max(200),
  threadId: z.string().min(1).max(200),
  commentId: z.string().min(1).max(200),
})

/** 读取响应。 */
export const CollaborationTopicListSchema = z.object({
  topics: z.array(CollaborationTopicSchema),
})

export const CollaborationTopicDetailSchema = z.object({
  topic: CollaborationTopicSchema,
  threads: z.array(CollaborationThreadSchema),
})

export const CollaborationThreadListSchema = z.object({
  threads: z.array(CollaborationThreadSchema),
})

export const CollaborationThreadDetailSchema = z.object({
  thread: CollaborationThreadSchema,
  comments: z.array(CollaborationCommentSchema),
})

export const CollaborationCommentListSchema = z.object({
  comments: z.array(CollaborationCommentSchema),
})

export const CollaborationCommentResponseSchema = z.object({
  comment: CollaborationCommentSchema,
})

const TITLE_MAX = 500
const BODY_MAX = 20_000
const AUTHOR_MAX = 200

/** 写入请求。是否至少提供一个字段由 handler 校验，schema 只做形状与长度。 */
export const CollaborationCreateTopicSchema = z.object({
  title: z.string().min(1).max(TITLE_MAX),
  createdByAgent: z.string().min(1).max(AUTHOR_MAX).optional(),
})

export const CollaborationUpdateTopicSchema = z.object({
  title: z.string().min(1).max(TITLE_MAX).optional(),
  completed: z.boolean().optional(),
})

export const CollaborationCreateThreadSchema = z.object({
  title: z.string().min(1).max(TITLE_MAX),
  createdByAgent: z.string().min(1).max(AUTHOR_MAX).optional(),
})

export const CollaborationUpdateThreadSchema = z.object({
  title: z.string().min(1).max(TITLE_MAX).optional(),
  completed: z.boolean().optional(),
  userLastReadCommentId: z.string().min(1).max(200).nullable().optional(),
})

/** 排序：显式给出目标顺序的 id 列表；未列出的记录按原相对顺序排在后面。 */
export const CollaborationReorderSchema = z.object({
  orderedIds: z.array(z.string().min(1).max(200)).max(5000),
})

export const CollaborationSendCommentSchema = z.object({
  body: z.string().min(1).max(BODY_MAX),
  role: z.enum(["user", "agent"]).default("user"),
  authorAgent: z.string().min(1).max(AUTHOR_MAX).optional(),
  readByAgent: z.boolean().optional(),
})

export const CollaborationEditCommentSchema = z.object({
  body: z.string().min(1).max(BODY_MAX),
})

/** 搜索：标题与正文的关键词匹配；只读。 */
export const CollaborationSearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
})

/** 搜索命中的 Comment 额外带 topicId，前端才能定位到所属 Topic。 */
export const CollaborationSearchCommentSchema =
  CollaborationCommentSchema.extend({
    topicId: z.string().min(1),
  })

export const CollaborationSearchResultSchema = z.object({
  topics: z.array(CollaborationTopicSchema),
  threads: z.array(CollaborationThreadSchema),
  comments: z.array(CollaborationSearchCommentSchema),
})

/**
 * 变更事件：只说明「哪里变了」，不携带业务数据。
 * 事件不是真相来源，客户端收到后必须重新读取真实数据。
 */
export const CollaborationEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("topic_created"), topicId: z.string() }),
  z.object({ type: z.literal("topic_updated"), topicId: z.string() }),
  z.object({ type: z.literal("topic_deleted"), topicId: z.string() }),
  z.object({ type: z.literal("topics_reordered") }),
  z.object({
    type: z.literal("thread_created"),
    topicId: z.string(),
    threadId: z.string(),
  }),
  z.object({
    type: z.literal("thread_updated"),
    topicId: z.string(),
    threadId: z.string(),
  }),
  z.object({
    type: z.literal("thread_deleted"),
    topicId: z.string(),
    threadId: z.string(),
  }),
  z.object({ type: z.literal("threads_reordered"), topicId: z.string() }),
  z.object({
    type: z.literal("comment_created"),
    topicId: z.string(),
    threadId: z.string(),
    commentId: z.string(),
  }),
  z.object({
    type: z.literal("comment_updated"),
    topicId: z.string(),
    threadId: z.string(),
    commentId: z.string(),
  }),
  z.object({
    type: z.literal("comment_deleted"),
    topicId: z.string(),
    threadId: z.string(),
    commentId: z.string(),
  }),
])

export type CollaborationTopicPath = z.infer<
  typeof CollaborationTopicPathSchema
>
export type CollaborationThreadPath = z.infer<
  typeof CollaborationThreadPathSchema
>
export type CollaborationCommentPath = z.infer<
  typeof CollaborationCommentPathSchema
>
export type CollaborationTopicList = z.infer<
  typeof CollaborationTopicListSchema
>
export type CollaborationTopicDetail = z.infer<
  typeof CollaborationTopicDetailSchema
>
export type CollaborationThreadList = z.infer<
  typeof CollaborationThreadListSchema
>
export type CollaborationThreadDetail = z.infer<
  typeof CollaborationThreadDetailSchema
>
export type CollaborationCommentList = z.infer<
  typeof CollaborationCommentListSchema
>
export type CollaborationCommentResponse = z.infer<
  typeof CollaborationCommentResponseSchema
>
export type CollaborationCreateTopic = z.input<
  typeof CollaborationCreateTopicSchema
>
export type CollaborationUpdateTopic = z.input<
  typeof CollaborationUpdateTopicSchema
>
export type CollaborationCreateThread = z.input<
  typeof CollaborationCreateThreadSchema
>
export type CollaborationUpdateThread = z.input<
  typeof CollaborationUpdateThreadSchema
>
export type CollaborationReorder = z.input<typeof CollaborationReorderSchema>
export type CollaborationSendComment = z.input<
  typeof CollaborationSendCommentSchema
>
export type CollaborationEditComment = z.input<
  typeof CollaborationEditCommentSchema
>
export type CollaborationSearchQuery = z.input<
  typeof CollaborationSearchQuerySchema
>
export type CollaborationSearchComment = z.infer<
  typeof CollaborationSearchCommentSchema
>
export type CollaborationSearchResult = z.infer<
  typeof CollaborationSearchResultSchema
>
export type CollaborationEvent = z.infer<typeof CollaborationEventSchema>
