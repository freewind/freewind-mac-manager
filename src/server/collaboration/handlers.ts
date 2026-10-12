import { randomUUID } from "node:crypto"
import {
  PublicOperationError,
  publicSystemError,
} from "@server/common/public-error"
import { sanitizeInputText } from "@server/utils/sanitizeInputText"
import { contract, TASK_REQUEST_ID_HEADER } from "@shared/api-contract"
import { initServer } from "@ts-rest/express"
import { publishCollaborationEvent } from "./events"
import type { CollaborationStore } from "./store"

const s = initServer()

/** 路由键到契约条目的映射：handlers 只面对一份契约定义。 */
export const collaborationContract = {
  listCollaborationTopics: contract.listCollaborationTopics,
  createCollaborationTopic: contract.createCollaborationTopic,
  reorderCollaborationTopics: contract.reorderCollaborationTopics,
  getCollaborationTopic: contract.getCollaborationTopic,
  updateCollaborationTopic: contract.updateCollaborationTopic,
  deleteCollaborationTopic: contract.deleteCollaborationTopic,
  listCollaborationThreads: contract.listCollaborationThreads,
  createCollaborationThread: contract.createCollaborationThread,
  reorderCollaborationThreads: contract.reorderCollaborationThreads,
  getCollaborationThread: contract.getCollaborationThread,
  updateCollaborationThread: contract.updateCollaborationThread,
  deleteCollaborationThread: contract.deleteCollaborationThread,
  listCollaborationComments: contract.listCollaborationComments,
  sendCollaborationComment: contract.sendCollaborationComment,
  updateCollaborationComment: contract.updateCollaborationComment,
  deleteCollaborationComment: contract.deleteCollaborationComment,
  searchCollaboration: contract.searchCollaboration,
}

/** 归属校验：Topic 必须存在。 */
const requireTopic = (store: CollaborationStore, topicId: string) => {
  const topic = store.findTopic(topicId)
  if (!topic) throw new PublicOperationError(404, "Topic 不存在")
  return topic
}

/** 归属校验：Thread 必须存在且属于该 Topic；跨 Topic 的 id 一律判为不存在。 */
const requireThread = (
  store: CollaborationStore,
  topicId: string,
  threadId: string
) => {
  const thread = store.findThread(threadId)
  if (!thread || thread.topicId !== topicId) {
    throw new PublicOperationError(404, "Thread 不存在或不属于该 Topic")
  }
  return thread
}

/** 归属校验：Comment 必须存在且属于该 Thread。 */
const requireComment = (
  store: CollaborationStore,
  threadId: string,
  commentId: string
) => {
  const comment = store.findComment(commentId)
  if (!comment || comment.threadId !== threadId) {
    throw new PublicOperationError(404, "Comment 不存在或不属于该 Thread")
  }
  return comment
}

/** 只允许编辑/删除用户消息，与源项目 MessageNotEditableError 的语义一致。 */
const requireUserComment = (
  store: CollaborationStore,
  threadId: string,
  commentId: string
) => {
  const comment = requireComment(store, threadId, commentId)
  if (comment.role !== "user") {
    throw new PublicOperationError(403, "只能编辑或删除用户消息")
  }
  return comment
}

/** 由 comment 反查所属 Topic id：事件需要带齐 topicId 才能让订阅方定位。 */
const commentTopicId = (
  store: CollaborationStore,
  threadId: string
): string => {
  const thread = store.findThread(threadId)
  if (!thread) throw new PublicOperationError(404, "Thread 不存在")
  return thread.topicId
}

/** 读回最新读取形，避免把「读不到」当成正常结果返回。 */
const reloadTopic = (store: CollaborationStore, topicId: string) => {
  const topic = store.getTopic(topicId)
  if (!topic) throw new PublicOperationError(404, "Topic 不存在")
  return topic
}

const reloadThread = (
  store: CollaborationStore,
  topicId: string,
  threadId: string
) => {
  const thread = store.getThread(topicId, threadId)
  if (!thread) throw new PublicOperationError(404, "Thread 不存在")
  return thread
}

const nowIso = (): string => new Date().toISOString()

/** 创建后统一返回 Topic + 其 Thread 列表，避免调用方再发一次请求。 */
const topicDetail = (store: CollaborationStore, topicId: string) => ({
  topic: reloadTopic(store, topicId),
  threads: store.listThreads(topicId),
})

const threadDetail = (
  store: CollaborationStore,
  topicId: string,
  threadId: string
) => ({
  thread: reloadThread(store, topicId, threadId),
  comments: store.listComments(threadId),
})

const hasAnyField = (value: object): boolean => Object.keys(value).length > 0

/** 统一错误出口：业务异常与未知异常都映射成 PublicErrorStatus。 */
const respondError = (error: unknown) => {
  const mapped = publicSystemError(error)
  return { status: mapped.status, body: mapped.body }
}

/**
 * 评论正文清洗：源项目在追加 user / agent 评论与编辑 user 评论三处都会先
 * `sanitizeInputText(body).trim()`，空正文直接拒绝；这里对齐同一行为，
 * 避免终端鼠标/粘贴模式误灌的转义序列与控制字符落盘。
 * 只作用于评论正文：标题、导入数据都不经过它。
 */
const cleanCommentBody = (body: string): string => {
  const trimmed = sanitizeInputText(body).trim()
  if (!trimmed) throw new PublicOperationError(400, "消息不能为空")
  return trimmed
}

/** 幂等：同一请求标识重复提交时直接返回原消息，不再写入。 */
const sendCommentOnce = (
  store: CollaborationStore,
  topicId: string,
  threadId: string,
  requestId: string,
  input: {
    body: string
    role?: "user" | "agent"
    authorAgent?: string
    readByAgent?: boolean
  }
) => {
  const existing = store.findCommentByRequestId(requestId)
  if (existing) return { status: 200 as const, body: { comment: existing } }

  // 清洗放在幂等检查之后：重放必须原样返回已存消息，不因本次入参被判非法。
  const body = cleanCommentBody(input.body)
  const role = input.role ?? "user"
  const comment = store.appendComment(
    {
      id: `comment-${randomUUID()}`,
      threadId,
      role,
      body,
      createdAt: nowIso(),
      authorAgent: input.authorAgent ?? null,
      // 源项目：用户消息默认未读（readByAgent=false）；Agent 消息不参与未读统计。
      readByAgent: role === "user" ? (input.readByAgent ?? false) : null,
    },
    requestId
  )
  publishCollaborationEvent({
    type: "comment_created",
    topicId,
    threadId,
    commentId: comment.id,
  })
  return { status: 201 as const, body: { comment } }
}

export const createCollaborationRouter = (store: CollaborationStore) =>
  s.router(collaborationContract, {
    listCollaborationTopics: async () => {
      try {
        return { status: 200 as const, body: { topics: store.listTopics() } }
      } catch (error) {
        return respondError(error)
      }
    },

    createCollaborationTopic: async ({ body }) => {
      try {
        const record = store.createTopic({
          id: `topic-${randomUUID()}`,
          title: body.title,
          createdByAgent: body.createdByAgent ?? null,
          createdAt: nowIso(),
        })
        publishCollaborationEvent({
          type: "topic_created",
          topicId: record.id,
        })
        return { status: 201 as const, body: topicDetail(store, record.id) }
      } catch (error) {
        return respondError(error)
      }
    },

    reorderCollaborationTopics: async ({ body }) => {
      try {
        store.reorderTopics(body.orderedIds)
        publishCollaborationEvent({ type: "topics_reordered" })
        return { status: 200 as const, body: { topics: store.listTopics() } }
      } catch (error) {
        return respondError(error)
      }
    },

    getCollaborationTopic: async ({ params }) => {
      try {
        requireTopic(store, params.topicId)
        return {
          status: 200 as const,
          body: topicDetail(store, params.topicId),
        }
      } catch (error) {
        return respondError(error)
      }
    },

    updateCollaborationTopic: async ({ params, body }) => {
      try {
        requireTopic(store, params.topicId)
        if (!hasAnyField(body as object)) {
          throw new PublicOperationError(
            400,
            "至少提供 title 或 completed 之一"
          )
        }
        if (body.title !== undefined) {
          store.updateTopicTitle(params.topicId, body.title)
        }
        if (body.completed !== undefined) {
          store.setTopicCompleted(
            params.topicId,
            body.completed ? nowIso() : null
          )
        }
        publishCollaborationEvent({
          type: "topic_updated",
          topicId: params.topicId,
        })
        return {
          status: 200 as const,
          body: topicDetail(store, params.topicId),
        }
      } catch (error) {
        return respondError(error)
      }
    },

    deleteCollaborationTopic: async ({ params }) => {
      try {
        requireTopic(store, params.topicId)
        store.deleteTopic(params.topicId)
        publishCollaborationEvent({
          type: "topic_deleted",
          topicId: params.topicId,
        })
        return { status: 204 as const, body: null }
      } catch (error) {
        return respondError(error)
      }
    },

    listCollaborationThreads: async ({ params }) => {
      try {
        requireTopic(store, params.topicId)
        return {
          status: 200 as const,
          body: { threads: store.listThreads(params.topicId) },
        }
      } catch (error) {
        return respondError(error)
      }
    },

    createCollaborationThread: async ({ params, body }) => {
      try {
        requireTopic(store, params.topicId)
        const record = store.createThread({
          id: `thread-${randomUUID()}`,
          topicId: params.topicId,
          title: body.title,
          createdByAgent: body.createdByAgent ?? null,
          createdAt: nowIso(),
        })
        publishCollaborationEvent({
          type: "thread_created",
          topicId: params.topicId,
          threadId: record.id,
        })
        return {
          status: 201 as const,
          body: threadDetail(store, params.topicId, record.id),
        }
      } catch (error) {
        return respondError(error)
      }
    },

    reorderCollaborationThreads: async ({ params, body }) => {
      try {
        requireTopic(store, params.topicId)
        store.reorderThreads(params.topicId, body.orderedIds)
        publishCollaborationEvent({
          type: "threads_reordered",
          topicId: params.topicId,
        })
        return {
          status: 200 as const,
          body: { threads: store.listThreads(params.topicId) },
        }
      } catch (error) {
        return respondError(error)
      }
    },

    getCollaborationThread: async ({ params }) => {
      try {
        requireThread(store, params.topicId, params.threadId)
        return {
          status: 200 as const,
          body: threadDetail(store, params.topicId, params.threadId),
        }
      } catch (error) {
        return respondError(error)
      }
    },

    updateCollaborationThread: async ({ params, body }) => {
      try {
        requireThread(store, params.topicId, params.threadId)
        if (!hasAnyField(body as object)) {
          throw new PublicOperationError(
            400,
            "至少提供 title、completed 或 userLastReadCommentId 之一"
          )
        }
        if (body.title !== undefined) {
          store.updateThreadTitle(params.topicId, params.threadId, body.title)
        }
        if (body.completed !== undefined) {
          store.setThreadCompleted(
            params.topicId,
            params.threadId,
            body.completed ? nowIso() : null
          )
        }
        if (body.userLastReadCommentId !== undefined) {
          store.setThreadReadPosition(
            params.topicId,
            params.threadId,
            body.userLastReadCommentId
          )
        }
        publishCollaborationEvent({
          type: "thread_updated",
          topicId: params.topicId,
          threadId: params.threadId,
        })
        return {
          status: 200 as const,
          body: threadDetail(store, params.topicId, params.threadId),
        }
      } catch (error) {
        return respondError(error)
      }
    },

    deleteCollaborationThread: async ({ params }) => {
      try {
        requireThread(store, params.topicId, params.threadId)
        store.deleteThread(params.topicId, params.threadId)
        publishCollaborationEvent({
          type: "thread_deleted",
          topicId: params.topicId,
          threadId: params.threadId,
        })
        return { status: 204 as const, body: null }
      } catch (error) {
        return respondError(error)
      }
    },

    listCollaborationComments: async ({ params }) => {
      try {
        requireThread(store, params.topicId, params.threadId)
        return {
          status: 200 as const,
          body: { comments: store.listComments(params.threadId) },
        }
      } catch (error) {
        return respondError(error)
      }
    },

    sendCollaborationComment: async ({ params, headers, body }) => {
      try {
        requireThread(store, params.topicId, params.threadId)
        return sendCommentOnce(
          store,
          params.topicId,
          params.threadId,
          headers[TASK_REQUEST_ID_HEADER],
          body
        )
      } catch (error) {
        return respondError(error)
      }
    },

    updateCollaborationComment: async ({ params, body }) => {
      try {
        requireUserComment(store, params.threadId, params.commentId)
        const topicId = commentTopicId(store, params.threadId)
        const updated = store.updateCommentBody(
          params.threadId,
          params.commentId,
          {
            body: cleanCommentBody(body.body),
            updatedAt: nowIso(),
            // 源项目：用户消息一旦编辑，未读标记重置为 false。
            readByAgent: false,
          }
        )
        if (!updated) throw new PublicOperationError(404, "Comment 不存在")
        publishCollaborationEvent({
          type: "comment_updated",
          topicId,
          threadId: params.threadId,
          commentId: params.commentId,
        })
        return { status: 200 as const, body: { comment: updated } }
      } catch (error) {
        return respondError(error)
      }
    },

    deleteCollaborationComment: async ({ params }) => {
      try {
        requireUserComment(store, params.threadId, params.commentId)
        store.deleteComment(params.threadId, params.commentId)
        publishCollaborationEvent({
          type: "comment_deleted",
          topicId: commentTopicId(store, params.threadId),
          threadId: params.threadId,
          commentId: params.commentId,
        })
        return { status: 204 as const, body: null }
      } catch (error) {
        return respondError(error)
      }
    },

    searchCollaboration: async ({ query }) => {
      try {
        return { status: 200 as const, body: store.search(query.q) }
      } catch (error) {
        return respondError(error)
      }
    },
  })
