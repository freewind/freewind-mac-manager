import {
  createAiTopic,
  createAiTopicThread,
  deleteAiTopic,
  deleteAiTopicThread,
  fetchAiTopic,
  fetchAiTopicThreadMessages,
  listAiTopics,
  markAiTopicThreadRead,
  renameAiTopic,
  renameAiTopicThread,
  setAiTopicThreadArchived,
} from "@shared/client-api"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

/** 执行期间的重新读取间隔：回答可能写进别的线程，只刷新当前线程会看不到。 */
export const TOPIC_REFRESH_INTERVAL_MS = 2500

/** 话题域的查询键：列表、详情与线程消息都由这里定义。 */
export const aiTopicKeys = {
  all: ["ai-topics"] as const,
  list: () => [...aiTopicKeys.all, "list"] as const,
  detail: (topicId: string) => [...aiTopicKeys.all, "detail", topicId] as const,
  messages: (topicId: string, threadId: string) =>
    [...aiTopicKeys.all, "messages", topicId, threadId] as const,
}

export const useAiTopicsQuery = () =>
  useQuery({
    queryKey: aiTopicKeys.list(),
    queryFn: listAiTopics,
    retry: false,
  })

/**
 * 话题详情（话题 + 线程列表）。
 *
 * 执行期间轮询：本地正在发送时轮询，服务端报 running 时继续轮询。
 * 后者覆盖断线：浏览器断开后执行仍在继续，重新连上还能看到结果。
 */
export const useAiTopicQuery = (topicId: string | null, chatRunning = false) =>
  useQuery({
    queryKey: aiTopicKeys.detail(topicId ?? ""),
    queryFn: () => fetchAiTopic(topicId as string),
    enabled: Boolean(topicId),
    retry: false,
    refetchInterval: (query) => {
      if (chatRunning) return TOPIC_REFRESH_INTERVAL_MS
      return query.state.data?.topic.status === "running"
        ? TOPIC_REFRESH_INTERVAL_MS
        : false
    },
  })

export const useAiTopicMessagesQuery = (
  topicId: string | null,
  threadId: string | null,
  polling = false
) =>
  useQuery({
    queryKey: aiTopicKeys.messages(topicId ?? "", threadId ?? ""),
    queryFn: () =>
      fetchAiTopicThreadMessages(topicId as string, threadId as string),
    enabled: Boolean(topicId && threadId),
    retry: false,
    refetchInterval: polling ? TOPIC_REFRESH_INTERVAL_MS : false,
  })

/** 话题与线程的写入都只失效相关查询：列表、详情与受影响线程的消息。 */
const useInvalidateTopic = () => {
  const queryClient = useQueryClient()
  return {
    list: () => queryClient.invalidateQueries({ queryKey: aiTopicKeys.list() }),
    detail: (topicId: string) =>
      queryClient.invalidateQueries({
        queryKey: aiTopicKeys.detail(topicId),
      }),
    messages: (topicId: string, threadId: string) =>
      queryClient.invalidateQueries({
        queryKey: aiTopicKeys.messages(topicId, threadId),
      }),
    /** 执行反馈：话题详情与全部线程消息都要重新读，Agent 可能写进别处。 */
    topicAll: (topicId: string) => {
      void queryClient.invalidateQueries({
        queryKey: aiTopicKeys.detail(topicId),
      })
      void queryClient.invalidateQueries({
        queryKey: [...aiTopicKeys.all, "messages", topicId],
      })
    },
  }
}

export const useCreateAiTopic = () => {
  const invalidate = useInvalidateTopic()
  return useMutation({
    mutationFn: (title: string) => createAiTopic(title),
    onSuccess: (detail) => {
      void invalidate.list()
      void invalidate.detail(detail.topic.id)
    },
  })
}

export const useRenameAiTopic = () => {
  const invalidate = useInvalidateTopic()
  return useMutation({
    mutationFn: (input: { topicId: string; title: string }) =>
      renameAiTopic(input.topicId, input.title),
    onSuccess: (detail) => {
      void invalidate.list()
      void invalidate.detail(detail.topic.id)
    },
  })
}

export const useDeleteAiTopic = () => {
  const invalidate = useInvalidateTopic()
  return useMutation({
    mutationFn: (topicId: string) => deleteAiTopic(topicId),
    onSuccess: () => {
      void invalidate.list()
    },
  })
}

export const useCreateAiTopicThread = () => {
  const invalidate = useInvalidateTopic()
  return useMutation({
    mutationFn: (input: { topicId: string; title: string }) =>
      createAiTopicThread(input.topicId, input.title),
    onSuccess: (_result, input) => {
      void invalidate.detail(input.topicId)
    },
  })
}

export const useRenameAiTopicThread = () => {
  const invalidate = useInvalidateTopic()
  return useMutation({
    mutationFn: (input: { topicId: string; threadId: string; title: string }) =>
      renameAiTopicThread(input.topicId, input.threadId, input.title),
    onSuccess: (_result, input) => {
      void invalidate.detail(input.topicId)
    },
  })
}

export const useArchiveAiTopicThread = () => {
  const invalidate = useInvalidateTopic()
  return useMutation({
    mutationFn: (input: {
      topicId: string
      threadId: string
      archived: boolean
    }) =>
      setAiTopicThreadArchived(input.topicId, input.threadId, input.archived),
    onSuccess: (_result, input) => {
      void invalidate.detail(input.topicId)
    },
  })
}

export const useDeleteAiTopicThread = () => {
  const invalidate = useInvalidateTopic()
  return useMutation({
    mutationFn: (input: { topicId: string; threadId: string }) =>
      deleteAiTopicThread(input.topicId, input.threadId),
    onSuccess: (_result, input) => {
      void invalidate.detail(input.topicId)
    },
  })
}

/**
 * 标记已读。失败不弹提示：未读点只是提示，读失败不该打断阅读；
 * 下一次打开线程时会再试一次。
 */
export const useMarkAiTopicThreadRead = () => {
  const invalidate = useInvalidateTopic()
  return useMutation({
    mutationFn: (input: { topicId: string; threadId: string }) =>
      markAiTopicThreadRead(input.topicId, input.threadId),
    onSuccess: (_result, input) => {
      void invalidate.detail(input.topicId)
    },
  })
}
