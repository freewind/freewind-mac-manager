import type {
  AiCallExecution,
  AiCallSessionDetail,
  AiCallSessionList,
} from "@shared/api-contract"
import { apiClient, unwrap } from "./client"

export const listAiCallSessions = async (): Promise<AiCallSessionList> =>
  unwrap<AiCallSessionList>(await apiClient.listAiCallSessions())

/** 不传标题时由服务端按通话开始时间生成，用户不必先想名字。 */
export const createAiCallSession = async (
  title?: string
): Promise<AiCallSessionDetail> =>
  unwrap<AiCallSessionDetail>(
    await apiClient.createAiCallSession({ body: title ? { title } : {} })
  )

export const fetchAiCallSession = async (
  sessionId: string
): Promise<AiCallSessionDetail> =>
  unwrap<AiCallSessionDetail>(
    await apiClient.getAiCallSession({ params: { sessionId } })
  )

export const renameAiCallSession = async (
  sessionId: string,
  title: string
): Promise<AiCallSessionDetail> =>
  unwrap<AiCallSessionDetail>(
    await apiClient.updateAiCallSession({
      params: { sessionId },
      body: { title },
    })
  )

export const deleteAiCallSession = async (sessionId: string): Promise<void> => {
  unwrap<null>(await apiClient.deleteAiCallSession({ params: { sessionId } }))
}

export const fetchAiCallExecution = async (
  sessionId: string
): Promise<AiCallExecution> =>
  unwrap<AiCallExecution>(
    await apiClient.getAiCallExecution({ params: { sessionId } })
  )

export const stopAiCallExecution = async (
  sessionId: string
): Promise<AiCallExecution> =>
  unwrap<AiCallExecution>(
    await apiClient.stopAiCallExecution({ params: { sessionId } })
  )

/** 挂断：只标结束时间，历史仍可回看。 */
export const finishAiCallSession = async (
  sessionId: string
): Promise<AiCallSessionDetail> =>
  unwrap<AiCallSessionDetail>(
    await apiClient.finishAiCallSession({ params: { sessionId } })
  )
