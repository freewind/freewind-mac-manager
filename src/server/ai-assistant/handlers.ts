import { publicSystemError } from "@server/common/public-error"
import { contract } from "@shared/api-contract"
import { AiAssistantMessageRequestSchema } from "@shared/api-contract/schemas/ai-assistant"
import { ApiPath } from "@shared/api-path"
import { initServer } from "@ts-rest/express"
import type express from "express"
import { getAiAssistantSettings, saveAiAssistantSettings } from "./config"
import { createSession, getSession } from "./session"
import { clearSession, listSessions } from "./store"
import { streamSession } from "./stream"

const s = initServer()

/** 只挑本域的路由注册；app.ts 负责与其它功能合并。 */
export const aiAssistantContract = {
  getAiAssistantSettings: contract.getAiAssistantSettings,
  saveAiAssistantSettings: contract.saveAiAssistantSettings,
  listAiAssistantSessions: contract.listAiAssistantSessions,
  clearAiAssistantSession: contract.clearAiAssistantSession,
}

export const createAiAssistantRouter = () =>
  s.router(aiAssistantContract, {
    getAiAssistantSettings: async () => {
      try {
        return { status: 200 as const, body: getAiAssistantSettings() }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    saveAiAssistantSettings: async ({ body }) => {
      try {
        return { status: 200 as const, body: saveAiAssistantSettings(body) }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    listAiAssistantSessions: async () => {
      try {
        return { status: 200 as const, body: { sessions: listSessions() } }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    clearAiAssistantSession: async ({ params }) => {
      try {
        clearSession(params.sessionId)
        return { status: 204 as const, body: null }
      } catch (error) {
        return publicSystemError(error)
      }
    },
  })

/**
 * SSE 流式端点有意不进 ts-rest 契约：ts-rest 不支持 text/event-stream 的响应形态。
 *
 * 请求体为 `{ sessionId?, prompt }`；省略 sessionId 时按当前设置新建会话，
 * 新会话标识通过 `x-ai-assistant-session-id` 响应头回传，供后续多轮复用。
 */
export const registerAiAssistantStreamEndpoint = (
  app: express.Express
): void => {
  app.post(ApiPath.aiAssistantMessage, async (request, response) => {
    const parsed = AiAssistantMessageRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({
        message: "请求参数无效：prompt 必填且不超过 10000 字符",
      })
      return
    }
    try {
      const existingId = parsed.data.sessionId
      const created = existingId
        ? null
        : await createSession(getAiAssistantSettings())
      const sessionId = existingId ?? created?.sessionId ?? ""
      const session = created?.session ?? getSession(sessionId)
      // 必须在写 SSE 头之前设置：客户端据此拿到新建会话的标识。
      response.setHeader("x-ai-assistant-session-id", sessionId)
      await streamSession(session, sessionId, parsed.data.prompt, response)
    } catch (error) {
      // 还没开始写 SSE 时仍回普通 JSON 错误；已写流则交给 streamSession 收尾。
      if (response.headersSent) return
      const failure = publicSystemError(error)
      response.status(failure.status).json(failure.body)
    }
  })
}
