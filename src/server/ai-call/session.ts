import {
  type AgentSession,
  type FileEntry,
  parseSessionEntries,
  SessionManager,
} from "@earendil-works/pi-coding-agent"
import { getAiAssistantSettings } from "@server/ai-assistant/config"
import { buildSession } from "@server/ai-assistant/session"
import { callMacManagerApi } from "@server/ai-assistant/tool"
import { PublicOperationError } from "@server/common/public-error"
import { PROJECT_ROOT } from "@server/env"
import { AI_CALL_SYSTEM_PROMPT } from "./config"
import { AI_CALL_SPEAK_TOOL, createSpeakTool } from "./speak-tool"
import { readCallEntries } from "./store"

/**
 * 通话的 Agent 会话：一次通话一个会话，上下文在通话期间持续累积。
 *
 * 与话题的差别：系统提示词是口语化的、不挂线程工具，回答只能通过
 * speak 工具说出来。会话的搭建与恢复仍复用助手的 buildSession。
 */

/**
 * 通话可用的内置工具。
 *
 * 用户换掉豆包的理由就是「它碰不到我电脑上的东西」，所以这里放开读文件
 * 与执行命令；危险动作由提示词约束成先口头确认。会话本身仍以普通用户
 * 权限运行，没有额外提权。
 */
const CALL_BUILTIN_TOOLS = ["read", "grep", "ls", "bash"] as const

type CachedCallSession = {
  session: AgentSession
  controller: AbortController
  sessionManager: SessionManager
}

const sessions = new Map<string, CachedCallSession>()

/**
 * 从保存的 JSONL 恢复会话条目。
 *
 * 解析不出任何条目却确实有内容时一律报错：宁可让用户知道历史读不出来，
 * 也不能悄悄用空上下文继续通话，还让他以为之前说的仍然有效。
 */
const parseStoredEntries = (entriesText: string): FileEntry[] => {
  if (!entriesText.trim()) return []
  let entries: FileEntry[]
  try {
    entries = parseSessionEntries(entriesText)
  } catch (error) {
    throw new PublicOperationError(
      500,
      `通话历史无法读取，不能继续这次通话：${
        error instanceof Error ? error.message : "解析失败"
      }`
    )
  }
  if (entries.length === 0) {
    throw new PublicOperationError(500, "通话历史无法读取，不能继续这次通话")
  }
  return entries
}

/**
 * 取通话会话：内存里没有就按保存的条目恢复。
 *
 * 模型选择沿用 AI 助手那份设置：通话就是助手的语音形态，没理由让用户
 * 再配一遍。没有单独的通话设置界面，也就不需要第三张设置表。
 */
export const getOrCreateCallSession = async (
  sessionId: string
): Promise<AgentSession> => {
  const cached = sessions.get(sessionId)
  if (cached) return cached.session
  const settings = getAiAssistantSettings()
  const built = await buildSession({
    model: settings.settings,
    systemPrompt: AI_CALL_SYSTEM_PROMPT,
    customTools: [callMacManagerApi, createSpeakTool(sessionId)],
    // 漏掉自定义工具名会被 SDK 的 allowlist 整体剔除，必须显式列出。
    extraToolNames: [AI_CALL_SPEAK_TOOL],
    enabledTools: [...CALL_BUILTIN_TOOLS],
    sessionManager: SessionManager.inMemory(
      PROJECT_ROOT,
      undefined,
      parseStoredEntries(readCallEntries(sessionId))
    ),
  })
  sessions.set(sessionId, built)
  return built.session
}

/**
 * 把通话会话的完整条目序列化成 JSONL。
 *
 * 保存的是 Pi 自己的会话格式：包含工具调用与结果、压缩摘要，
 * 下次恢复出的上下文与这次完全相同。
 */
export const serializeCallSession = (sessionId: string): string | null => {
  const entry = sessions.get(sessionId)
  if (!entry) return null
  const header = entry.sessionManager.getHeader()
  const entries = entry.sessionManager.getEntries()
  const all: FileEntry[] = header ? [header, ...entries] : entries
  return `${all.map((item) => JSON.stringify(item)).join("\n")}\n`
}

export const disposeCallSession = (sessionId: string): void => {
  const entry = sessions.get(sessionId)
  if (!entry) return
  sessions.delete(sessionId)
  entry.controller.abort()
  entry.session.dispose()
}
