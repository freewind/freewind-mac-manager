import {
  PublicOperationError,
  publicSystemError,
} from "@server/common/public-error"
import {
  contract,
  TASK_REQUEST_ID_HEADER,
  TaskRequestIdSchema,
} from "@shared/api-contract"
import {
  AiAssistantHistoryMessageSchema,
  AiAssistantMessageRequestSchema,
} from "@shared/api-contract/schemas/ai-assistant"
import { ApiPath } from "@shared/api-path"
import { initServer } from "@ts-rest/express"
import type express from "express"
import { getAiAssistantSettings, saveAiAssistantSettings } from "./config"
import {
  type ExecutionSnapshot,
  findExecutionByRequestId,
  getExecution,
  stopExecution,
} from "./runner"
import { createSession, disposeSession, getSession } from "./session"
import { clearSession, listSessions, readSession } from "./store"
import { streamExecutionEvents, streamSession } from "./stream"

const s = initServer()

/** 只挑本域的路由注册；app.ts 负责与其它功能合并。 */
export const aiAssistantContract = {
  getAiAssistantSettings: contract.getAiAssistantSettings,
  saveAiAssistantSettings: contract.saveAiAssistantSettings,
  listAiAssistantSessions: contract.listAiAssistantSessions,
  clearAiAssistantSession: contract.clearAiAssistantSession,
  getAiAssistantExecution: contract.getAiAssistantExecution,
  stopAiAssistantExecution: contract.stopAiAssistantExecution,
}

/**
 * 会话历史逐条过校验：早期版本留下的异常形状直接不返回，
 * 不让一条坏记录把整个响应打挂；历史已不存在时按空列表处理。
 */
const historyMessages = (
  sessionId: string
): { role: "user" | "assistant"; text: string }[] => {
  let stored: unknown[]
  try {
    stored = readSession(sessionId).messages
  } catch {
    return []
  }
  const messages: { role: "user" | "assistant"; text: string }[] = []
  for (const message of stored) {
    const parsed = AiAssistantHistoryMessageSchema.safeParse(message)
    if (parsed.success) messages.push(parsed.data)
  }
  return messages
}

const executionResponse = (execution: ExecutionSnapshot) => ({
  execution,
  messages: historyMessages(execution.sessionId),
})

/**
 * 请求标识可选：带上它，同一标识重复提交会复用同一次执行，不产生第二次副作用。
 * 格式与其它写操作一致，非法值直接拒绝，不静默忽略。
 */
const readRequestId = (request: express.Request): string | null => {
  const raw = request.headers[TASK_REQUEST_ID_HEADER]
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value === undefined || value === "") return null
  const parsed = TaskRequestIdSchema.safeParse(value)
  if (!parsed.success) {
    throw new PublicOperationError(400, "请求标识格式不合法")
  }
  return parsed.data
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
        // 正在执行的会话在存储层会被拒；清空后一并丢掉内存会话，
        // 否则删了历史会话还能继续跑。
        clearSession(params.sessionId)
        disposeSession(params.sessionId)
        return { status: 204 as const, body: null }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    getAiAssistantExecution: async ({ params }) => {
      try {
        return {
          status: 200 as const,
          body: executionResponse(getExecution(params.executionId)),
        }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    stopAiAssistantExecution: async ({ params }) => {
      try {
        return {
          status: 200 as const,
          body: executionResponse(stopExecution(params.executionId)),
        }
      } catch (error) {
        return publicSystemError(error)
      }
    },
  })

/**
 * SSE 端点有意不进 ts-rest 契约：ts-rest 不支持 text/event-stream 的响应形态。
 *
 * 两个端点都是订阅式，执行的生命周期在 runner 里，跟 response 无关：
 * - POST `aiAssistantMessage`：提交一次执行并订阅。请求体为
 *   `{ sessionId?, prompt }`；省略 sessionId 时按当前设置新建会话。
 *   新会话标识通过 `x-ai-assistant-session-id` 回传，执行标识通过
 *   `x-ai-assistant-execution-id` 回传，后者供断线后按标识重新订阅。
 * - GET `aiAssistantExecutionEvents`：只订阅已存在的执行，不重发原指令。
 *
 * 连接断开只退订，不中止 Agent 及其工具子进程。
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
      const requestId = readRequestId(request)
      const existingId = parsed.data.sessionId
      // 重复提交（同一请求标识）要复用已有执行：不能再建一个会话，
      // 那本身就是第二次副作用，还会让会话标识指向错的对象。
      const replay = requestId ? findExecutionByRequestId(requestId) : null
      const created =
        existingId || replay
          ? null
          : await createSession(getAiAssistantSettings())
      const sessionId =
        replay?.sessionId ?? existingId ?? created?.sessionId ?? ""
      const session = created?.session ?? getSession(sessionId)
      // 必须在写 SSE 头之前设置：客户端据此拿到新建会话的标识。
      response.setHeader("x-ai-assistant-session-id", sessionId)
      await streamSession(session, sessionId, parsed.data.prompt, response, {
        requestId,
      })
    } catch (error) {
      // 还没开始写 SSE 时仍回普通 JSON 错误；已写流则交给订阅层收尾。
      if (response.headersSent) return
      // 会话正忙或请求标识已用过：明确告知这次没有开始执行，可以安全重试。
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

  app.get(ApiPath.aiAssistantExecutionEvents, async (request, response) => {
    try {
      await streamExecutionEvents(String(request.params.executionId), response)
    } catch (error) {
      if (response.headersSent) return
      const failure = publicSystemError(error)
      response.status(failure.status).json(failure.body)
    }
  })
}
