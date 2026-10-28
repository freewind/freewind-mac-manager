import {
  PublicOperationError,
  publicSystemError,
} from "@server/common/public-error"
import { contract } from "@shared/api-contract"
import { AiTopicMessageRequestSchema } from "@shared/api-contract/schemas/ai-topic"
import { ApiPath } from "@shared/api-path"
import { initServer } from "@ts-rest/express"
import type express from "express"
import { getAiAssistantSettings } from "./config"
import { readRequestId } from "./handlers"
import {
  type ExecutionPersistence,
  runningExecutionId,
  stopExecution,
} from "./runner"
import {
  getOrCreateTopicSession,
  serializeTopicSession,
  topicRunContext,
} from "./session"
import { streamSession } from "./stream"
import {
  appendMessage,
  createThread,
  createTopic,
  deleteThread,
  deleteTopic,
  findTopicByRequestId,
  finishTopicRun,
  getThread,
  getTopic,
  listMessages,
  listThreads,
  listTopics,
  readTopicEntries,
  renameTopic,
  saveTopicEntries,
  startTopicRun,
  updateThread,
} from "./topic-store"

const s = initServer()

/** 只挑本域的路由；app.ts 负责与其它功能合并。 */
export const aiTopicContract = {
  listAiTopics: contract.listAiTopics,
  createAiTopic: contract.createAiTopic,
  getAiTopic: contract.getAiTopic,
  updateAiTopic: contract.updateAiTopic,
  deleteAiTopic: contract.deleteAiTopic,
  createAiTopicThread: contract.createAiTopicThread,
  updateAiTopicThread: contract.updateAiTopicThread,
  deleteAiTopicThread: contract.deleteAiTopicThread,
  listAiTopicThreadMessages: contract.listAiTopicThreadMessages,
  stopAiTopicExecution: contract.stopAiTopicExecution,
}

/**
 * 话题的执行落库适配层。
 *
 * 用户消息在执行开始时落库（同一请求标识只落一条）；Agent 的回答由
 * reply_thread 工具写入目标线程。Agent 一次都没调用工具时，把最终文本
 * 兜底写回本次提问的线程——宁可多写一次，也不能让答案消失。
 */
const topicPersistence: ExecutionPersistence = {
  hasRequest: (requestId) => findTopicByRequestId(requestId) !== null,
  startRun: (topicId, userMessage, requestId) => {
    const context = topicRunContext(topicId)
    if (!context.currentThreadId) {
      throw new PublicOperationError(
        409,
        "没有记录本次提问的线程，无法开始执行"
      )
    }
    appendMessage({
      topicId,
      threadId: context.currentThreadId,
      role: "user",
      body: context.userText ?? userMessage.text,
      requestId,
    })
    startTopicRun(topicId, "running", requestId)
  },
  // 中间结果不落库：回答的最终归宿是线程消息，由工具写入。
  saveAnswer: () => {},
  finishRun: (topicId, status, answer) => {
    const context = topicRunContext(topicId)
    if (!context.replied && answer && context.currentThreadId) {
      appendMessage({
        topicId,
        threadId: context.currentThreadId,
        role: "agent",
        body: answer,
      })
      context.replied = true
    }
    finishTopicRun(topicId, status)
  },
  saveContext: (topicId) => {
    const entries = serializeTopicSession(topicId)
    if (entries) saveTopicEntries(topicId, entries)
  },
}

export const createAiTopicRouter = () =>
  s.router(aiTopicContract, {
    listAiTopics: async () => {
      try {
        return { status: 200 as const, body: { topics: listTopics() } }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    createAiTopic: async ({ body }) => {
      try {
        const topic = createTopic(body.title)
        return {
          status: 201 as const,
          body: { topic, threads: listThreads(topic.id) },
        }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    getAiTopic: async ({ params }) => {
      try {
        return {
          status: 200 as const,
          body: {
            topic: getTopic(params.topicId),
            threads: listThreads(params.topicId),
          },
        }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    updateAiTopic: async ({ params, body }) => {
      try {
        const topic = renameTopic(params.topicId, body.title)
        return {
          status: 200 as const,
          body: { topic, threads: listThreads(topic.id) },
        }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    deleteAiTopic: async ({ params }) => {
      try {
        deleteTopic(params.topicId)
        return { status: 204 as const, body: null }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    createAiTopicThread: async ({ params, body }) => {
      try {
        return {
          status: 201 as const,
          body: {
            thread: createThread(
              params.topicId,
              body.title,
              body.createdBy ?? "user"
            ),
          },
        }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    updateAiTopicThread: async ({ params, body }) => {
      try {
        return {
          status: 200 as const,
          body: {
            thread: updateThread(params.topicId, params.threadId, body),
          },
        }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    deleteAiTopicThread: async ({ params }) => {
      try {
        deleteThread(params.topicId, params.threadId)
        return { status: 204 as const, body: null }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    listAiTopicThreadMessages: async ({ params, query }) => {
      try {
        return {
          status: 200 as const,
          body: {
            thread: getThread(params.topicId, params.threadId),
            messages: listMessages(
              params.topicId,
              params.threadId,
              query.limit
            ),
          },
        }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    stopAiTopicExecution: async ({ params }) => {
      try {
        getTopic(params.topicId)
        const running = runningExecutionId(params.topicId)
        if (!running) {
          throw new PublicOperationError(409, "话题当前没有正在执行的任务")
        }
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
 * 话题对话（SSE，传输例外）。
 *
 * 一次请求属于一个话题、从某个线程发出；回复写回哪个线程由 Agent 的工具
 * 决定，服务端只负责绑定话题与运行时上下文，跨话题的线程 id 会被拒绝。
 */
export const registerAiTopicStreamEndpoint = (app: express.Express): void => {
  app.post(ApiPath.aiTopicMessage, async (request, response) => {
    const topicId = String(request.params.topicId ?? "")
    const parsed = AiTopicMessageRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({
        message: "请求参数无效：threadId 必填，prompt 不超过 10000 字符",
      })
      return
    }
    try {
      const requestId = readRequestId(request)
      const topic = getTopic(topicId)
      const thread = getThread(topicId, parsed.data.threadId)
      if (thread.archivedAt !== null) {
        throw new PublicOperationError(409, "该线程已归档，请先恢复再提问")
      }
      if (topic.status === "running" && runningExecutionId(topicId)) {
        throw new PublicOperationError(
          409,
          "话题正在执行中，请等待结束或先停止"
        )
      }
      // 运行上下文必须在建会话之前设好：工具闭包读的就是这个对象。
      const context = topicRunContext(topicId)
      context.currentThreadId = thread.id
      context.userText = parsed.data.prompt
      context.replied = false
      const session = await getOrCreateTopicSession(
        topicId,
        getAiAssistantSettings(),
        readTopicEntries(topicId)
      )
      // 把线程身份写进指令：模型据此知道回答该写到哪个线程。
      const prompt = `【线程 ${thread.title}｜${thread.id}】\n${parsed.data.prompt}`
      await streamSession(session, topicId, prompt, response, {
        requestId,
        persistence: topicPersistence,
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
