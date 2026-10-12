import { randomUUID } from "node:crypto"
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  type ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent"
import { PublicOperationError } from "@server/common/public-error"
import { PI_AGENT_DIR, PROJECT_ROOT } from "@server/env"
import type { AiAssistantSettingsResponse } from "@shared/api-contract"
import { AI_ASSISTANT_DEFAULT_TOOLS } from "@shared/api-contract/schemas/ai-assistant"
import { AI_ASSISTANT_DEFAULT_SYSTEM_PROMPT } from "./config"
import { createAssistantModelRuntime } from "./model-runtime"
import { saveSession } from "./store"
import { AI_ASSISTANT_TOOL_NAME, callMacManagerApi } from "./tool"

/** 超过这个时间没被使用的会话会被回收：SDK 会话是内存态，长期挂着只会占资源。 */
export const AI_ASSISTANT_SESSION_IDLE_MS = 30 * 60 * 1000

type CachedSession = {
  session: AgentSession
  runtime: ModelRuntime
  controller: AbortController
  lastUsedAt: number
}

const sessions = new Map<string, CachedSession>()

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
  settings: AiAssistantSettingsResponse
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
    systemPromptOverride: () =>
      settings.settings.systemPrompt ?? AI_ASSISTANT_DEFAULT_SYSTEM_PROMPT,
    appendSystemPromptOverride: () => [],
  })
  await loader.reload()
  return loader
}

export const createSession = async (
  settings: AiAssistantSettingsResponse
): Promise<{ sessionId: string; session: AgentSession }> => {
  const now = Date.now()
  cleanupIdleSessions(now)
  const { providerId, modelId, thinkingLevel } = settings.settings
  if (!providerId || !modelId) {
    throw new PublicOperationError(400, "请先在设置中选择 AI 助手模型")
  }
  const controller = new AbortController()
  const runtime = await createAssistantModelRuntime(controller.signal)
  const model = runtime.getModel(providerId, modelId)
  if (!model) throw new PublicOperationError(404, "所选模型不在当前 Pi 配置中")
  const resourceLoader = await loadResourceLoader(settings)
  const enabledTools = settings.settings.enabledTools ?? [
    ...AI_ASSISTANT_DEFAULT_TOOLS,
  ]
  const { session } = await createAgentSession({
    cwd: PROJECT_ROOT,
    agentDir: PI_AGENT_DIR,
    modelRuntime: runtime,
    model,
    thinkingLevel,
    customTools: [callMacManagerApi],
    // 自定义工具也在 SDK 的 allowlist 过滤范围内：漏掉它就会把
    // call_mac_manager_api 整体剔除，助手只剩 read/bash 等内置工具可用。
    tools: [...new Set([AI_ASSISTANT_TOOL_NAME, ...enabledTools])],
    resourceLoader,
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
    session,
    runtime,
    controller,
    lastUsedAt: now,
  })
  return { sessionId, session }
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
  const entry = sessions.get(sessionId)
  if (entry) {
    sessions.delete(sessionId)
    entry.controller.abort()
    entry.session.dispose()
  }
  for (const listener of disposeListeners) listener(sessionId)
}
