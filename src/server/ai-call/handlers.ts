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
import {
  createCallPersona,
  deleteCallPersona,
  listCallPersonas,
  requireCallPersona,
  updateCallPersona,
} from "./persona-store"
import { disposeIdleCallSessions, getOrCreateCallSession } from "./session"
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
  listAiCallPersonas: contract.listAiCallPersonas,
  createAiCallPersona: contract.createAiCallPersona,
  updateAiCallPersona: contract.updateAiCallPersona,
  deleteAiCallPersona: contract.deleteAiCallPersona,
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
        // 没配模型不是内部错误：告诉用户缺什么，而不是让界面静默没反应。
        if (error instanceof TranscribeUnavailableError) {
          return { status: 500 as const, body: { message: error.message } }
        }
        return publicSystemError(error)
      }
    },
    listAiCallPersonas: async () => {
      try {
        return {
          status: 200 as const,
          body: { personas: listCallPersonas() },
        }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    createAiCallPersona: async ({ body }) => {
      try {
        return { status: 201 as const, body: createCallPersona(body) }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    updateAiCallPersona: async ({ params, body }) => {
      try {
        const persona = updateCallPersona(params.personaId, body)
        // 提示词与模型都可能变了：丢空闲会话，下次通话才用新设置。
        disposeIdleCallSessions(
          (sessionId) => runningExecutionId(sessionId) !== null
        )
        return { status: 200 as const, body: persona }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    deleteAiCallPersona: async ({ params }) => {
      try {
        deleteCallPersona(params.personaId)
        return { status: 204 as const, body: null }
      } catch (error) {
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
        // 不指定角色时用第一个：至少得有一个角色才能开始通话。
        const personaId = body.personaId ?? listCallPersonas()[0]?.id
        if (!personaId) {
          throw new PublicOperationError(400, "请先在设置里创建一个通话角色")
        }
        requireCallPersona(personaId)
        const session = createCallSession(body.title, personaId)
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
