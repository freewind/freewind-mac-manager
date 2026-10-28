import { randomUUID } from "node:crypto"
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  type FileEntry,
  type ModelRuntime,
  parseSessionEntries,
  SessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent"
import { PublicOperationError } from "@server/common/public-error"
import { PI_AGENT_DIR, PROJECT_ROOT } from "@server/env"
import type { AiAssistantSettingsResponse } from "@shared/api-contract"
import { AI_ASSISTANT_DEFAULT_TOOLS } from "@shared/api-contract/schemas/ai-assistant"
import {
  AI_ASSISTANT_DEFAULT_SYSTEM_PROMPT,
  AI_TOPIC_DEFAULT_SYSTEM_PROMPT,
} from "./config"
import { createAssistantModelRuntime } from "./model-runtime"
import { saveSession } from "./store"
import { AI_ASSISTANT_TOOL_NAME, callMacManagerApi } from "./tool"
import { saveTopicSettingsSnapshot } from "./topic-store"
import {
  AI_TOPIC_TOOL_NAMES,
  createTopicToolset,
  type TopicRunContext,
} from "./topic-tools"

/** 超过这个时间没被使用的会话会被回收：SDK 会话是内存态，长期挂着只会占资源。 */
export const AI_ASSISTANT_SESSION_IDLE_MS = 30 * 60 * 1000

type CachedSession = {
  session: AgentSession
  runtime: ModelRuntime
  controller: AbortController
  sessionManager: SessionManager
  lastUsedAt: number
}

const sessions = new Map<string, CachedSession>()

/**
 * 话题的执行上下文：本次提问来自哪个线程。
 *
 * 同一话题同时只允许一次执行（见下方在途锁），所以这里的可变字段不会
 * 被两次执行抢写；工具闭包读它，就能默认回复到用户提问的线程。
 */
const topicContexts = new Map<string, TopicRunContext>()

/**
 * 在途锁：同一会话同时只允许一次运行。
 * 它在进入 SSE 之前申请（否则第二个请求会写坏第一个 run 的状态），
 * 由调用方在 finally 里释放；dispose 会话时也会一并清掉。
 */
const inFlight = new Set<string>()

export const beginSessionRun = (sessionId: string): boolean => {
  if (inFlight.has(sessionId)) return false
  inFlight.add(sessionId)
  return true
}

export const endSessionRun = (sessionId: string): void => {
  inFlight.delete(sessionId)
}

export const isSessionRunning = (sessionId: string): boolean =>
  inFlight.has(sessionId)

/**
 * 空闲回收只针对真的闲着的会话：正在执行的会话即使久未访问也不能回收，
 * 否则会把还在跑的执行连根拔掉（用户切后台、断线都不得中断执行）。
 */
const cleanupIdleSessions = (now: number): void => {
  for (const [id, entry] of sessions) {
    if (now - entry.lastUsedAt <= AI_ASSISTANT_SESSION_IDLE_MS) continue
    if (inFlight.has(id)) continue
    sessions.delete(id)
    entry.controller.abort()
    entry.session.dispose()
  }
}

/**
 * 会话被丢弃时的通知口。
 *
 * 丢弃会话（含服务关闭时的清理）与「取消执行」是两件事：执行的生命周期归
 * runner，它收到通知后只能把正在跑的执行按「结果未知」收尾，绝不能因为
 * 清理内存会话就把它写成成功。用监听而不是直接依赖 runner，避免两者循环 import。
 */
const disposeListeners = new Set<(sessionId: string) => void>()

export const onSessionDisposed = (
  listener: (sessionId: string) => void
): (() => void) => {
  disposeListeners.add(listener)
  return () => {
    disposeListeners.delete(listener)
  }
}

const loadResourceLoader = async (
  systemPrompt: string
): Promise<DefaultResourceLoader> => {
  const loader = new DefaultResourceLoader({
    cwd: PROJECT_ROOT,
    agentDir: PI_AGENT_DIR,
    // 助手是产品的一部分，不是编码 agent：全局 extensions / skills / prompt 模板 /
    // 主题与项目上下文（AGENTS.md）都不属于它，一律不加载，避免全局插件污染
    // 助手的工具集与提示词。它只应该有我们显式注册的 customTools。
    noContextFiles: true,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPromptOverride: () => systemPrompt,
    appendSystemPromptOverride: () => [],
  })
  await loader.reload()
  return loader
}

type BuildSessionInput = {
  settings: AiAssistantSettingsResponse
  systemPrompt: string
  customTools: ToolDefinition[]
  /** 额外必须启用的工具名：漏掉自定义工具会被 SDK 的 allowlist 整体剔除。 */
  extraToolNames: string[]
  /** 覆盖本次会话启用的内置工具；不传时用助手设置里的选择。 */
  enabledTools?: string[]
  sessionManager: SessionManager
}

const buildSession = async (input: BuildSessionInput) => {
  const { providerId, modelId, thinkingLevel } = input.settings.settings
  if (!providerId || !modelId) {
    throw new PublicOperationError(400, "请先在设置中选择 AI 助手模型")
  }
  const controller = new AbortController()
  const runtime = await createAssistantModelRuntime(controller.signal)
  const model = runtime.getModel(providerId, modelId)
  if (!model) throw new PublicOperationError(404, "所选模型不在当前 Pi 配置中")
  const resourceLoader = await loadResourceLoader(input.systemPrompt)
  const enabledTools = input.enabledTools ??
    input.settings.settings.enabledTools ?? [...AI_ASSISTANT_DEFAULT_TOOLS]
  const { session } = await createAgentSession({
    cwd: PROJECT_ROOT,
    agentDir: PI_AGENT_DIR,
    modelRuntime: runtime,
    model,
    thinkingLevel,
    customTools: input.customTools,
    tools: [
      ...new Set([
        AI_ASSISTANT_TOOL_NAME,
        ...input.extraToolNames,
        ...enabledTools,
      ]),
    ],
    resourceLoader,
    sessionManager: input.sessionManager,
  })
  return {
    session,
    runtime,
    controller,
    sessionManager: input.sessionManager,
  }
}

export const createSession = async (
  settings: AiAssistantSettingsResponse
): Promise<{ sessionId: string; session: AgentSession }> => {
  const now = Date.now()
  cleanupIdleSessions(now)
  const built = await buildSession({
    settings,
    systemPrompt:
      settings.settings.systemPrompt ?? AI_ASSISTANT_DEFAULT_SYSTEM_PROMPT,
    customTools: [callMacManagerApi],
    extraToolNames: [],
    sessionManager: SessionManager.inMemory(),
  })
  const sessionId = randomUUID()
  saveSession({
    id: sessionId,
    settingsSnapshot: settings,
    status: "idle",
    createdAt: now,
    updatedAt: now,
  })
  sessions.set(sessionId, {
    session: built.session,
    runtime: built.runtime,
    controller: built.controller,
    sessionManager: built.sessionManager,
    lastUsedAt: now,
  })
  return { sessionId, session: built.session }
}

/**
 * 从外部保存的 JSONL 恢复会话条目。
 *
 * 解析不出任何条目却确实有内容时一律报错：宁可让用户知道历史读不出来，
 * 也不能悄悄用空上下文继续对话，还让他以为之前的讨论仍然有效。
 */
const parseStoredEntries = (entriesText: string): FileEntry[] => {
  if (!entriesText.trim()) return []
  let entries: FileEntry[]
  try {
    entries = parseSessionEntries(entriesText)
  } catch (error) {
    throw new PublicOperationError(
      500,
      `话题历史无法读取，不能继续对话：${error instanceof Error ? error.message : "解析失败"}`
    )
  }
  if (entries.length === 0) {
    throw new PublicOperationError(500, "话题历史无法读取，不能继续对话")
  }
  return entries
}

/**
 * 话题只开放只读的内置工具：它用来讨论与理解项目，不该顺手动文件。
 * 需要操作本机能力时走 call_mac_manager_api，写操作仍要用户确认。
 */
const TOPIC_BUILTIN_TOOLS = ["read", "grep", "ls"] as const

/** 本次执行的提问线程：工具默认写回它。 */
export const topicRunContext = (topicId: string): TopicRunContext => {
  const existing = topicContexts.get(topicId)
  if (existing) return existing
  const created: TopicRunContext = {
    currentThreadId: null,
    userText: null,
    replied: false,
  }
  topicContexts.set(topicId, created)
  return created
}

/**
 * 取话题会话：内存里没有就按保存的条目恢复。
 *
 * 一个话题对应一个 Agent 对话，线程不持有自己的会话，所以这里只有一份
 * 会话与一份运行上下文，恢复失败会明确报错而不是退化成空对话。
 */
export const getOrCreateTopicSession = async (
  topicId: string,
  settings: AiAssistantSettingsResponse,
  entriesText: string
): Promise<AgentSession> => {
  const now = Date.now()
  cleanupIdleSessions(now)
  const cached = sessions.get(topicId)
  if (cached) {
    cached.lastUsedAt = now
    return cached.session
  }
  const runContext = topicRunContext(topicId)
  const built = await buildSession({
    settings,
    systemPrompt: AI_TOPIC_DEFAULT_SYSTEM_PROMPT,
    customTools: [
      callMacManagerApi,
      ...createTopicToolset(topicId, runContext),
    ],
    extraToolNames: [...AI_TOPIC_TOOL_NAMES],
    enabledTools: [...TOPIC_BUILTIN_TOOLS],
    sessionManager: SessionManager.inMemory(
      PROJECT_ROOT,
      undefined,
      parseStoredEntries(entriesText)
    ),
  })
  saveTopicSettingsSnapshot(topicId, settings)
  sessions.set(topicId, {
    session: built.session,
    runtime: built.runtime,
    controller: built.controller,
    sessionManager: built.sessionManager,
    lastUsedAt: now,
  })
  return built.session
}

/**
 * 把话题会话的完整条目序列化成 JSONL。
 *
 * 保存的是 Pi 自己的会话格式：包含工具调用与结果、压缩摘要，
 * 下次恢复出的上下文与这次完全相同。
 */
export const serializeTopicSession = (topicId: string): string | null => {
  const entry = sessions.get(topicId)
  if (!entry) return null
  const header = entry.sessionManager.getHeader()
  const entries = entry.sessionManager.getEntries()
  const all: FileEntry[] = header ? [header, ...entries] : entries
  return `${all.map((item) => JSON.stringify(item)).join("\n")}\n`
}

export const getSession = (sessionId: string): AgentSession => {
  const now = Date.now()
  cleanupIdleSessions(now)
  const entry = sessions.get(sessionId)
  if (!entry) {
    throw new PublicOperationError(404, "会话不存在或已过期，请新建会话")
  }
  entry.lastUsedAt = now
  return entry.session
}

export const disposeSession = (sessionId: string): void => {
  inFlight.delete(sessionId)
  topicContexts.delete(sessionId)
  const entry = sessions.get(sessionId)
  if (entry) {
    sessions.delete(sessionId)
    entry.controller.abort()
    entry.session.dispose()
  }
  for (const listener of disposeListeners) listener(sessionId)
}
