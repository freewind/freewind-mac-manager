import { z } from "zod"
import { AiAssistantExecutionSchema } from "./ai-assistant"

/**
 * AI 话题：一个话题对应一个 Agent 对话，话题下的线程只是问题与回答的组织方式。
 *
 * 线程不是独立会话：所有消息都进入同一个话题上下文，Agent 通过工具把回答
 * 写到指定线程。未读数、线程数都是派生值，不落库。
 */

const TITLE_MAX = 200
const BODY_MAX = 20_000
const PROMPT_MAX = 10_000

/** 话题与助手会话共用一套执行状态语义。 */
export const AiTopicStatusSchema = z.enum([
  "idle",
  "running",
  "done",
  "unknown",
])

export const AiTopicThreadAuthorSchema = z.enum(["user", "agent"])

export const AiTopicThreadSchema = z.object({
  id: z.string().min(1),
  topicId: z.string().min(1),
  title: z.string(),
  /** null 表示未归档；归档线程仍可读取历史，但不再接收新问题。 */
  archivedAt: z.number().nullable(),
  createdBy: AiTopicThreadAuthorSchema,
  position: z.number().int().nonnegative(),
  createdAt: z.number(),
  updatedAt: z.number(),
  messageCount: z.number().int().nonnegative(),
  /** 用户已读位置之后、角色为 agent 的消息条数。 */
  unreadCount: z.number().int().nonnegative(),
})

export const AiTopicSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  status: AiTopicStatusSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  threadCount: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
})

export const AiTopicMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  role: z.enum(["user", "agent"]),
  body: z.string(),
  /** 话题内单调递增序号：排序与未读判断都以它为准。 */
  seq: z.number().int().positive(),
  createdAt: z.number(),
})

export const AiTopicPathSchema = z.object({
  topicId: z.string().min(1).max(200),
})

export const AiTopicThreadPathSchema = z.object({
  topicId: z.string().min(1).max(200),
  threadId: z.string().min(1).max(200),
})

export const AiTopicListSchema = z.object({
  topics: z.array(AiTopicSchema),
})

export const AiTopicDetailSchema = z.object({
  topic: AiTopicSchema,
  threads: z.array(AiTopicThreadSchema),
})

export const AiTopicThreadResponseSchema = z.object({
  thread: AiTopicThreadSchema,
})

export const AiTopicThreadMessagesSchema = z.object({
  thread: AiTopicThreadSchema,
  messages: z.array(AiTopicMessageSchema),
})

export const AiTopicCreateSchema = z.object({
  title: z.string().min(1).max(TITLE_MAX),
})

export const AiTopicUpdateSchema = z.object({
  title: z.string().min(1).max(TITLE_MAX),
})

export const AiTopicThreadCreateSchema = z.object({
  title: z.string().min(1).max(TITLE_MAX),
  /** 默认由用户创建；Agent 走工具时由服务端填 agent。 */
  createdBy: AiTopicThreadAuthorSchema.optional(),
})

/** 改名、归档/恢复、标记已读：字段都可选，至少给一个由 handler 校验。 */
export const AiTopicThreadUpdateSchema = z.object({
  title: z.string().min(1).max(TITLE_MAX).optional(),
  archived: z.boolean().optional(),
  read: z.boolean().optional(),
})

/**
 * 话题当前执行：没有执行时 execution 为 null。
 *
 * 不用 404 表达「没有正在执行」——404 已经用于「话题不存在」，
 * 混在一起会让客户端分不清该重试还是该新建话题。
 */
export const AiTopicExecutionSchema = z.object({
  execution: AiAssistantExecutionSchema.nullable(),
})

export const AiTopicThreadMessagesQuerySchema = z.object({
  /** 返回最近多少条；服务端会夹到上限，避免一次拉整段历史。 */
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

/** SSE 端点的请求体：threadId 是本次提问所在的线程。 */
export const AiTopicMessageRequestSchema = z.object({
  threadId: z.string().min(1).max(200),
  prompt: z.string().min(1).max(PROMPT_MAX),
})

export type AiTopicStatus = z.infer<typeof AiTopicStatusSchema>
export type AiTopicThread = z.infer<typeof AiTopicThreadSchema>
export type AiTopic = z.infer<typeof AiTopicSchema>
export type AiTopicMessage = z.infer<typeof AiTopicMessageSchema>
export type AiTopicPath = z.infer<typeof AiTopicPathSchema>
export type AiTopicThreadPath = z.infer<typeof AiTopicThreadPathSchema>
export type AiTopicList = z.infer<typeof AiTopicListSchema>
export type AiTopicDetail = z.infer<typeof AiTopicDetailSchema>
export type AiTopicThreadResponse = z.infer<typeof AiTopicThreadResponseSchema>
export type AiTopicThreadMessages = z.infer<typeof AiTopicThreadMessagesSchema>
export type AiTopicCreate = z.infer<typeof AiTopicCreateSchema>
export type AiTopicUpdate = z.infer<typeof AiTopicUpdateSchema>
export type AiTopicThreadCreate = z.infer<typeof AiTopicThreadCreateSchema>
export type AiTopicThreadUpdate = z.infer<typeof AiTopicThreadUpdateSchema>
export type AiTopicMessageRequest = z.infer<typeof AiTopicMessageRequestSchema>
export type AiTopicExecution = z.infer<typeof AiTopicExecutionSchema>

/** 正文长度上限导出给服务端复用，避免两处各写一个数字。 */
export const AI_TOPIC_BODY_MAX = BODY_MAX
export const AI_TOPIC_TITLE_MAX = TITLE_MAX
