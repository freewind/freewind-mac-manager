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
