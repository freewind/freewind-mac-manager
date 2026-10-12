import { publicSystemError } from "@server/common/public-error"
import { contract } from "@shared/api-contract"
import { ApiPath } from "@shared/api-path"
import { initServer } from "@ts-rest/express"
import type express from "express"
import { getAiAssistantSettings, saveAiAssistantSettings } from "./config"
import { clearSession, listSessions } from "./store"

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
 * SSE 流式端点有意不进 ts-rest 契约：ts-rest 不支持 text/event-stream 的
 * 流式响应形态。这里先挂 501 空壳，会话实现在后续任务接管。
 */
export const registerAiAssistantStreamEndpoint = (
  app: express.Express
): void => {
  app.post(ApiPath.aiAssistantMessage, (_request, response) => {
    response.status(501).json({ message: "SSE 流式端点尚未实现" })
  })
}
