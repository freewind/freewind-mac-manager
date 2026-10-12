import type {
  AiAssistantExecutionResponse,
  AiAssistantSessionList,
  AiAssistantSettingsInput,
  AiAssistantSettingsResponse,
} from "@shared/api-contract"
import { apiClient, unwrap } from "./client"

export const fetchAiAssistantSettings =
  async (): Promise<AiAssistantSettingsResponse> =>
    unwrap<AiAssistantSettingsResponse>(
      await apiClient.getAiAssistantSettings()
    )

export const saveAiAssistantSettings = async (
  input: AiAssistantSettingsInput
) =>
  unwrap<AiAssistantSettingsResponse>(
    await apiClient.saveAiAssistantSettings({ body: input })
  )

export const listAiAssistantSessions =
  async (): Promise<AiAssistantSessionList> =>
    unwrap<AiAssistantSessionList>(await apiClient.listAiAssistantSessions())

export const clearAiAssistantSession = async (sessionId: string) =>
  unwrap(await apiClient.clearAiAssistantSession({ params: { sessionId } }))

/** 查一次执行的状态与所属会话历史：断线后据此确认是否已经跑完。 */
export const fetchAiAssistantExecution = async (
  executionId: string
): Promise<AiAssistantExecutionResponse> =>
  unwrap<AiAssistantExecutionResponse>(
    await apiClient.getAiAssistantExecution({ params: { executionId } })
  )

/** 显式停止一次执行：这是取消的唯一入口，断线不会取消。 */
export const stopAiAssistantExecution = async (
  executionId: string
): Promise<AiAssistantExecutionResponse> =>
  unwrap<AiAssistantExecutionResponse>(
    await apiClient.stopAiAssistantExecution({ params: { executionId } })
  )
