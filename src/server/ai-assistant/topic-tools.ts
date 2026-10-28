import { Type } from "@earendil-works/pi-ai"
import { defineTool } from "@earendil-works/pi-coding-agent"
import { PublicOperationError } from "@server/common/public-error"
import {
  appendMessage,
  createThread,
  getThread,
  listThreads,
  updateThread,
} from "./topic-store"

/**
 * Agent 的线程管理工具。
 *
 * 一个话题只有一个 Agent：工具不需要模型自己指定话题，话题由服务端在建会话
 * 时绑定（闭包），跨话题的线程 id 在存储层按归属直接拒绝。这样「回复到正确
 * 的线程」不依赖提示词，而是一条被校验的写入路径。
 */

export const AI_TOPIC_CREATE_THREAD_TOOL = "create_thread"
export const AI_TOPIC_REPLY_THREAD_TOOL = "reply_thread"
export const AI_TOPIC_RENAME_THREAD_TOOL = "rename_thread"
export const AI_TOPIC_ARCHIVE_THREAD_TOOL = "archive_thread"
export const AI_TOPIC_LIST_THREADS_TOOL = "list_threads"

export const AI_TOPIC_TOOL_NAMES = [
  AI_TOPIC_CREATE_THREAD_TOOL,
  AI_TOPIC_REPLY_THREAD_TOOL,
  AI_TOPIC_RENAME_THREAD_TOOL,
  AI_TOPIC_ARCHIVE_THREAD_TOOL,
  AI_TOPIC_LIST_THREADS_TOOL,
] as const

/** 每次执行前由服务端设置：本次提问来自哪个线程。 */
export type TopicRunContext = {
  currentThreadId: string | null
  /** 本次执行的用户原文（不带线程标注），落库只看它。 */
  userText: string | null
  /** 本次执行是否已经把回答写进某个线程：用于兜底，避免答案丢失。 */
  replied: boolean
}

const text = (value: string) => ({
  content: [{ type: "text" as const, text: value }],
  details: {},
})

const failed = (error: unknown) => {
  const message =
    error instanceof PublicOperationError
      ? error.message
      : error instanceof Error
        ? error.message
        : "工具执行失败"
  return {
    content: [{ type: "text" as const, text: `操作失败：${message}` }],
    details: {},
    isError: true,
  }
}

const threadIdOf = (
  runContext: TopicRunContext,
  provided: string | undefined
): string => {
  const id = provided?.trim() || runContext.currentThreadId
  if (!id) {
    throw new PublicOperationError(
      400,
      "没有指定线程，也不知道当前线程；请先用 list_threads 查线程 id"
    )
  }
  return id
}

export const createTopicToolset = (
  topicId: string,
  runContext: TopicRunContext
) => [
  defineTool({
    name: AI_TOPIC_CREATE_THREAD_TOOL,
    label: "新建线程",
    description:
      "在当前话题下新建一个线程，用来单独讨论一个具体问题。返回新线程的 id。把一个问题拆到新线程后，必须再用 reply_thread 把回答写进那个线程。",
    parameters: Type.Object({
      title: Type.String({ description: "线程标题，简短说明这个问题" }),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const thread = createThread(topicId, params.title, "agent")
        return text(JSON.stringify({ id: thread.id, title: thread.title }))
      } catch (error) {
        return failed(error)
      }
    },
  }),
  defineTool({
    name: AI_TOPIC_REPLY_THREAD_TOOL,
    label: "在指定线程回复",
    description:
      "把一条回答写进指定线程。threadId 省略时写入本次提问所在的线程。回答用户问题时必须用它写入，不要只在正文里说。可以分多次调用，把不同问题的答案分别写进不同线程。",
    parameters: Type.Object({
      content: Type.String({ description: "要写入该线程的完整内容" }),
      threadId: Type.Optional(
        Type.String({ description: "目标线程 id；省略表示本次提问所在线程" })
      ),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const threadId = threadIdOf(runContext, params.threadId)
        const thread = getThread(topicId, threadId)
        const message = appendMessage({
          topicId,
          threadId,
          role: "agent",
          body: params.content,
        })
        // 只要写过一次，就不再走兜底：不能把同一段回答写两遍。
        runContext.replied = true
        return text(
          JSON.stringify({
            threadId: thread.id,
            title: thread.title,
            messageId: message.id,
            seq: message.seq,
          })
        )
      } catch (error) {
        return failed(error)
      }
    },
  }),
  defineTool({
    name: AI_TOPIC_RENAME_THREAD_TOOL,
    label: "重命名线程",
    description:
      "修改线程标题。当线程标题不再能说明内容时使用，例如讨论范围发生变化。",
    parameters: Type.Object({
      threadId: Type.String({ description: "线程 id" }),
      title: Type.String({ description: "新的线程标题" }),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const thread = updateThread(topicId, params.threadId, {
          title: params.title,
        })
        return text(JSON.stringify({ id: thread.id, title: thread.title }))
      } catch (error) {
        return failed(error)
      }
    },
  }),
  defineTool({
    name: AI_TOPIC_ARCHIVE_THREAD_TOOL,
    label: "归档线程",
    description:
      "归档或恢复线程。已完成、不再需要跟进的问题可以归档；archived 传 false 表示恢复。删除线程只能由用户在界面上确认，你不能删除。",
    parameters: Type.Object({
      threadId: Type.String({ description: "线程 id" }),
      archived: Type.Optional(
        Type.Boolean({ description: "true 归档（默认），false 恢复" })
      ),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const thread = updateThread(topicId, params.threadId, {
          archived: params.archived ?? true,
        })
        return text(
          JSON.stringify({
            id: thread.id,
            archived: thread.archivedAt !== null,
          })
        )
      } catch (error) {
        return failed(error)
      }
    },
  }),
  defineTool({
    name: AI_TOPIC_LIST_THREADS_TOOL,
    label: "列出线程",
    description:
      "列出当前话题的全部线程及其 id、标题、归档状态。需要确认线程 id 或回顾话题结构时使用。",
    parameters: Type.Object({}),
    execute: async () => {
      try {
        return text(
          JSON.stringify({
            threads: listThreads(topicId).map((thread) => ({
              id: thread.id,
              title: thread.title,
              archived: thread.archivedAt !== null,
              messageCount: thread.messageCount,
            })),
          })
        )
      } catch (error) {
        return failed(error)
      }
    },
  }),
]
