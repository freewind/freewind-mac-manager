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

const cleanupIdleSessions = (now: number): void => {
  for (const [id, entry] of sessions) {
    if (now - entry.lastUsedAt <= AI_ASSISTANT_SESSION_IDLE_MS) continue
    sessions.delete(id)
    entry.controller.abort()
    entry.session.dispose()
  }
}

const loadResourceLoader = async (
  settings: AiAssistantSettingsResponse
): Promise<DefaultResourceLoader> => {
  const loader = new DefaultResourceLoader({
    cwd: PROJECT_ROOT,
    agentDir: PI_AGENT_DIR,
    // 助手的定位由本域提示词决定，不加载项目的 AGENTS.md，避免它被当成编码 agent。
    noContextFiles: true,
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
  const entry = sessions.get(sessionId)
  if (!entry) return
  sessions.delete(sessionId)
  entry.controller.abort()
  entry.session.dispose()
}
