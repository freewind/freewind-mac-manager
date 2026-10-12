import type {
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
