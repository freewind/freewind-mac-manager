import { z } from "zod"
import { AiAssistantExecutionSchema } from "./ai-assistant"

/**
 * AI 通话：一次通话就是一个会话，消息线性排列。
 *
 * 与 AI 话题不同，通话不分话题与线程：说话是顺序的，不存在并发分支。
 * 回答由 Agent 直接输出正文（语音要念的就是这段话），不通过写线程的工具，
 * 所以这里只需要「谁说了什么」，不需要线程归属。
 *
 * 被打断的回答必须能看出来：用户打断后那半句话没有念完，回看历史时
 * 不能让它冒充一条完整回答。
 */

const TITLE_MAX = 200
const PROMPT_MAX = 10_000

/** 会话状态与助手、话题共用一套执行语义。 */
export const AiCallStatusSchema = z.enum(["idle", "running", "done", "unknown"])

export const AiCallRoleSchema = z.enum(["user", "agent"])

export const AiCallMessageSchema = z.object({
  id: z.string().min(1),
  role: AiCallRoleSchema,
  body: z.string(),
  /** 被打断：这句回答没有念完，界面要明确标出来。 */
  interrupted: z.boolean(),
  createdAt: z.number(),
})

export const AiCallSessionSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  status: AiCallStatusSchema,
  messageCount: z.number().int().min(0),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** 挂断时间；还在通话中为 null。 */
  finishedAt: z.number().nullable(),
  /**
   * 最后一次被打断的时间。
   *
   * 打断发生时本轮回答可能还没落盘，所以先在会话上记一笔，等执行收尾
   * 写完最后一条回答后，再据此给它打 interrupted 标记。
   */
  interruptedAt: z.number().nullable(),
  /** 这次通话用哪个角色（提示词与模型都来自它）。 */
  personaId: z.string().nullable(),
})

/**
 * 通话角色：一套提示词加自己的模型。
 *
 * 与 AI 助手完全分开：助手是操作台，通话角色是聊天对象，两边提示词与
 * 模型各管各的。不内置默认角色，用户建了才能开始通话。
 */
export const AiCallPersonaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  systemPrompt: z.string().max(8000),
  /** 空表示跟随 AI 助手当前模型。 */
  providerId: z.string().max(256).nullable(),
  modelId: z.string().max(256).nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const AiCallPersonaListSchema = z.object({
  personas: z.array(AiCallPersonaSchema),
})

export const AiCallPersonaCreateSchema = z.object({
  name: z.string().min(1).max(60),
  systemPrompt: z.string().max(8000).default(""),
  providerId: z.string().max(256).optional(),
  modelId: z.string().max(256).optional(),
})

export const AiCallPersonaUpdateSchema = AiCallPersonaCreateSchema

export const AiCallPersonaPathSchema = z.object({
  personaId: z.string().min(1).max(200),
})

export const AiCallSessionPathSchema = z.object({
  sessionId: z.string().min(1).max(200),
})

export const AiCallSessionListSchema = z.object({
  sessions: z.array(AiCallSessionSchema),
})

export const AiCallSessionDetailSchema = z.object({
  session: AiCallSessionSchema,
  messages: z.array(AiCallMessageSchema),
})

export const AiCallSessionCreateSchema = z.object({
  /** 省略时服务端按通话开始时间生成标题。 */
  title: z.string().min(1).max(TITLE_MAX).optional(),
  /** 这次通话用哪个角色；没有角色时不能开始通话。 */
  personaId: z.string().min(1).max(200).optional(),
})

export const AiCallSessionUpdateSchema = z.object({
  title: z.string().min(1).max(TITLE_MAX),
})

/** SSE 端点的请求体：本次发言的识别文本。 */
export const AiCallMessageRequestSchema = z.object({
  prompt: z.string().min(1).max(PROMPT_MAX),
})

/**
 * 当前执行：没有执行时 execution 为 null。
 *
 * 不用 404 表达「没有正在执行」——404 已经用于「会话不存在」，
 * 混在一起会让客户端分不清该重试还是该新建通话。
 */
export const AiCallExecutionSchema = z.object({
  execution: AiAssistantExecutionSchema.nullable(),
})

export type AiCallStatus = z.infer<typeof AiCallStatusSchema>
export type AiCallRole = z.infer<typeof AiCallRoleSchema>
export type AiCallMessage = z.infer<typeof AiCallMessageSchema>
export type AiCallSession = z.infer<typeof AiCallSessionSchema>
export type AiCallSessionPath = z.infer<typeof AiCallSessionPathSchema>
export type AiCallSessionList = z.infer<typeof AiCallSessionListSchema>
export type AiCallSessionDetail = z.infer<typeof AiCallSessionDetailSchema>
export type AiCallSessionCreate = z.infer<typeof AiCallSessionCreateSchema>
export type AiCallSessionUpdate = z.infer<typeof AiCallSessionUpdateSchema>
export type AiCallMessageRequest = z.infer<typeof AiCallMessageRequestSchema>
export type AiCallExecution = z.infer<typeof AiCallExecutionSchema>
/**
 * 通话自己的 AI 配置：只存提示词。
 *
 * 模型沿用 AI 助手那份：通话就是助手的语音形态，不另配一套模型。
 * 提示词决定它怎么说话、什么时候打断，和助手那段分开写。
 */
export const AiCallSettingsSchema = z.object({
  systemPrompt: z.string().max(8000).optional(),
})

export const AiCallSettingsResponseSchema = z.object({
  settings: AiCallSettingsSchema,
  signature: z.string().length(64),
  updatedAt: z.number(),
  /** 默认提示词：界面用它区分「未自定义」与「已自定义」。 */
  defaults: z.object({ systemPrompt: z.string() }),
})

export const AiCallSettingsMutationSchema = z.object({
  signature: z.string().length(64),
  settings: AiCallSettingsSchema,
  clearFields: z.array(z.enum(["systemPrompt"])).default([]),
})

export type AiCallSettings = z.infer<typeof AiCallSettingsSchema>
export type AiCallSettingsResponse = z.infer<
  typeof AiCallSettingsResponseSchema
>
export type AiCallSettingsInput = z.input<typeof AiCallSettingsMutationSchema>
export type AiCallPersona = z.infer<typeof AiCallPersonaSchema>
export type AiCallPersonaList = z.infer<typeof AiCallPersonaListSchema>
export type AiCallPersonaInput = z.input<typeof AiCallPersonaCreateSchema>
export type AiCallPersonaPath = z.infer<typeof AiCallPersonaPathSchema>
