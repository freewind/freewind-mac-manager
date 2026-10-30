import { readRequestId } from "@server/ai-assistant/handlers"
import {
  getExecution,
  runningExecutionId,
  stopExecution,
} from "@server/ai-assistant/runner"
import { streamSession } from "@server/ai-assistant/stream"
import {
  PublicOperationError,
  publicSystemError,
} from "@server/common/public-error"
import { contract } from "@shared/api-contract"
import { AiCallMessageRequestSchema } from "@shared/api-contract/schemas/ai-call"
import { ApiPath } from "@shared/api-path"
import { initServer } from "@ts-rest/express"
import type express from "express"
import { callPersistence } from "./persistence"
import { getOrCreateCallSession } from "./session"
import {
  createCallSession,
  deleteCallSession,
  finishCallSession,
  getCallSession,
  listCallMessages,
  listCallSessions,
  markCallInterrupted,
  renameCallSession,
} from "./store"
import { TranscribeUnavailableError, transcribePcm } from "./transcribe"

const s = initServer()

/** 只挑本域的路由；app.ts 负责与其它功能合并。 */
export const aiCallContract = {
  transcribeAiCallAudio: contract.transcribeAiCallAudio,
  listAiCallSessions: contract.listAiCallSessions,
  createAiCallSession: contract.createAiCallSession,
  getAiCallSession: contract.getAiCallSession,
  updateAiCallSession: contract.updateAiCallSession,
  deleteAiCallSession: contract.deleteAiCallSession,
  finishAiCallSession: contract.finishAiCallSession,
  getAiCallExecution: contract.getAiCallExecution,
  stopAiCallExecution: contract.stopAiCallExecution,
}

/** 会话 + 完整消息：界面一次拿到就能渲染，不必再补一次请求。 */
const detail = (sessionId: string) => ({
  session: getCallSession(sessionId),
  messages: listCallMessages(sessionId),
})

export const createAiCallRouter = () =>
  s.router(aiCallContract, {
    transcribeAiCallAudio: async ({ body }) => {
      try {
        const pcm = Buffer.from(body.audio, "base64")
        return {
          status: 200 as const,
          body: { text: await transcribePcm(pcm) },
        }
      } catch (error) {
        // 组件未安装不是「内部错误」：告诉用户该跑哪条命令。
        if (error instanceof TranscribeUnavailableError) {
          return { status: 500 as const, body: { message: error.message } }
        }
        return publicSystemError(error)
      }
    },
    listAiCallSessions: async () => {
      try {
        return {
          status: 200 as const,
          body: { sessions: listCallSessions() },
        }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    createAiCallSession: async ({ body }) => {
      try {
        const session = createCallSession(body.title)
        return { status: 201 as const, body: detail(session.id) }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    getAiCallSession: async ({ params }) => {
      try {
        return { status: 200 as const, body: detail(params.sessionId) }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    updateAiCallSession: async ({ params, body }) => {
      try {
        renameCallSession(params.sessionId, body.title)
        return { status: 200 as const, body: detail(params.sessionId) }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    deleteAiCallSession: async ({ params }) => {
      try {
        deleteCallSession(params.sessionId)
        return { status: 204 as const, body: null }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    finishAiCallSession: async ({ params }) => {
      try {
        finishCallSession(params.sessionId)
        return { status: 200 as const, body: detail(params.sessionId) }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    getAiCallExecution: async ({ params }) => {
      try {
        getCallSession(params.sessionId)
        const running = runningExecutionId(params.sessionId)
        return {
          status: 200 as const,
          body: { execution: running ? getExecution(running) : null },
        }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    stopAiCallExecution: async ({ params }) => {
      try {
        getCallSession(params.sessionId)
        const running = runningExecutionId(params.sessionId)
        if (!running) {
          throw new PublicOperationError(409, "当前没有正在进行的回答")
        }
        // 先记被打断，再中止：中止后执行会立刻收尾，顺序反了标记就落空。
        markCallInterrupted(params.sessionId)
        return {
          status: 200 as const,
          body: { execution: stopExecution(running) },
        }
      } catch (error) {
        return publicSystemError(error)
      }
    },
  })

/**
 * 通话对话（SSE，传输例外）。
 *
 * 一次发言属于一个会话，回答直接来自 Agent 正文——语音要念的就是这段正文，
 * 所以这里不需要任何线程绑定。执行归服务端：连接断开只解除订阅，
 * 重新连上按执行标识还能看到同一执行的进度。
 */
export const registerAiCallStreamEndpoint = (app: express.Express): void => {
  app.post(ApiPath.aiCallMessage, async (request, response) => {
    const sessionId = String(request.params.sessionId ?? "")
    const parsed = AiCallMessageRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({
        message: "请求参数无效：prompt 必填，且不超过 10000 字符",
      })
      return
    }
    try {
      const requestId = readRequestId(request)
      const session = getCallSession(sessionId)
      if (session.status === "running" && runningExecutionId(sessionId)) {
        throw new PublicOperationError(409, "正在回答中，请等待结束或先打断")
      }
      const agent = await getOrCreateCallSession(sessionId)
      await streamSession(agent, sessionId, parsed.data.prompt, response, {
        requestId,
        persistence: callPersistence,
      })
    } catch (error) {
      if (response.headersSent) return
      if (error instanceof PublicOperationError && error.status === 409) {
        response
          .status(409)
          .json({ message: error.message, executionStatus: "not_started" })
        return
      }
      const failure = publicSystemError(error)
      response.status(failure.status).json(failure.body)
    }
  })
}
