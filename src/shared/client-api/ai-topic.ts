import type {
  AiTopicDetail,
  AiTopicExecution,
  AiTopicList,
  AiTopicThreadMessages,
  AiTopicThreadResponse,
} from "@shared/api-contract"
import { apiClient, unwrap } from "./client"

export const listAiTopics = async (): Promise<AiTopicList> =>
  unwrap<AiTopicList>(await apiClient.listAiTopics())

export const fetchAiTopic = async (topicId: string): Promise<AiTopicDetail> =>
  unwrap<AiTopicDetail>(await apiClient.getAiTopic({ params: { topicId } }))

export const createAiTopic = async (title: string): Promise<AiTopicDetail> =>
  unwrap<AiTopicDetail>(await apiClient.createAiTopic({ body: { title } }))

export const renameAiTopic = async (
  topicId: string,
  title: string
): Promise<AiTopicDetail> =>
  unwrap<AiTopicDetail>(
    await apiClient.updateAiTopic({ params: { topicId }, body: { title } })
  )

export const deleteAiTopic = async (topicId: string): Promise<void> => {
  unwrap<null>(await apiClient.deleteAiTopic({ params: { topicId } }))
}

export const createAiTopicThread = async (
  topicId: string,
  title: string
): Promise<AiTopicThreadResponse> =>
  unwrap<AiTopicThreadResponse>(
    await apiClient.createAiTopicThread({
      params: { topicId },
      body: { title },
    })
  )

export const renameAiTopicThread = async (
  topicId: string,
  threadId: string,
  title: string
): Promise<AiTopicThreadResponse> =>
  unwrap<AiTopicThreadResponse>(
    await apiClient.updateAiTopicThread({
      params: { topicId, threadId },
      body: { title },
    })
  )

export const setAiTopicThreadArchived = async (
  topicId: string,
  threadId: string,
  archived: boolean
): Promise<AiTopicThreadResponse> =>
  unwrap<AiTopicThreadResponse>(
    await apiClient.updateAiTopicThread({
      params: { topicId, threadId },
      body: { archived },
    })
  )

/** 标记已读：只推进到服务端当前最后一条，不会把之后到达的新消息算成已读。 */
export const markAiTopicThreadRead = async (
  topicId: string,
  threadId: string
): Promise<AiTopicThreadResponse> =>
  unwrap<AiTopicThreadResponse>(
    await apiClient.updateAiTopicThread({
      params: { topicId, threadId },
      body: { read: true },
    })
  )

export const deleteAiTopicThread = async (
  topicId: string,
  threadId: string
): Promise<void> => {
  unwrap<null>(
    await apiClient.deleteAiTopicThread({ params: { topicId, threadId } })
  )
}

export const fetchAiTopicThreadMessages = async (
  topicId: string,
  threadId: string
): Promise<AiTopicThreadMessages> =>
  unwrap<AiTopicThreadMessages>(
    await apiClient.listAiTopicThreadMessages({
      params: { topicId, threadId },
      query: {},
    })
  )

export const stopAiTopicExecution = async (
  topicId: string
): Promise<AiTopicExecution> =>
  unwrap<AiTopicExecution>(
    await apiClient.stopAiTopicExecution({ params: { topicId } })
  )
