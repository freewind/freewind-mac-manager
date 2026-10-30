import type {
  AiCallExecution,
  AiCallPersona,
  AiCallPersonaInput,
  AiCallPersonaList,
  AiCallSessionDetail,
  AiCallSessionList,
  AiCallTranscribeResponse,
} from "@shared/api-contract"
import { apiClient, unwrap } from "./client"

/**
 * 上传一段 16k 单声道 PCM 做识别。
 *
 * 识别在服务端走云端接口：手机不需要下载模型，也不占 CPU。
 */
export const transcribeAiCallAudio = async (
  audio: Uint8Array
): Promise<string> => {
  let binary = ""
  // 逐块转字符，避免大数组一次性展开撑爆调用栈。
  const chunk = 0x8000
  for (let index = 0; index < audio.length; index += chunk) {
    binary += String.fromCharCode(...audio.subarray(index, index + chunk))
  }
  const result = unwrap<AiCallTranscribeResponse>(
    await apiClient.transcribeAiCallAudio({
      body: { audio: btoa(binary), sampleRate: 16_000 },
    })
  )
  return result.text
}

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
