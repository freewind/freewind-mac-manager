import type {
  AiCallExecution,
  AiCallPersona,
  AiCallPersonaInput,
  AiCallPersonaList,
  AiCallSessionDetail,
  AiCallSessionList,
} from "@shared/api-contract"
import { apiClient, unwrap } from "./client"

/**
 * 通话不再上传音频：用户在手机上用系统语音输入法把文字打进输入框，
 * 本文件只负责会话、角色与执行控制。
 */

export const listAiCallSessions = async (): Promise<AiCallSessionList> =>
  unwrap<AiCallSessionList>(await apiClient.listAiCallSessions())

/** 不传标题时由服务端按通话开始时间生成，用户不必先想名字。 */
export const createAiCallSession = async (input: {
  personaId: string
  title?: string
}): Promise<AiCallSessionDetail> =>
  unwrap<AiCallSessionDetail>(
    await apiClient.createAiCallSession({ body: input })
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

/** 通话角色：每个角色一套提示词与自己的模型。 */
export const listAiCallPersonas = async (): Promise<AiCallPersonaList> =>
  unwrap<AiCallPersonaList>(await apiClient.listAiCallPersonas())

export const createAiCallPersona = async (
  input: AiCallPersonaInput
): Promise<AiCallPersona> =>
  unwrap<AiCallPersona>(await apiClient.createAiCallPersona({ body: input }))

export const updateAiCallPersona = async (
  personaId: string,
  input: AiCallPersonaInput
): Promise<AiCallPersona> =>
  unwrap<AiCallPersona>(
    await apiClient.updateAiCallPersona({ params: { personaId }, body: input })
  )

export const deleteAiCallPersona = async (personaId: string): Promise<void> => {
  unwrap<null>(await apiClient.deleteAiCallPersona({ params: { personaId } }))
}
