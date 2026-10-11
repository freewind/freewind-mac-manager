import type { PiModelsResponse, PiProviderInput } from "@shared/api-contract"
import { apiClient, unwrap } from "./client"

export const fetchPiModels = async (): Promise<PiModelsResponse> =>
  unwrap<PiModelsResponse>(await apiClient.listPiModels())

export const addPiProvider = async (input: {
  providerId: string
  signature: string
  provider: PiProviderInput
}) => apiClient.addPiProvider({ body: input })

export const updatePiProvider = async (
  providerId: string,
  input: {
    providerId: string
    signature: string
    provider: PiProviderInput
  }
) => apiClient.updatePiProvider({ params: { providerId }, body: input })

export const deletePiProvider = async (input: {
  providerId: string
  signature: string
}) =>
  apiClient.deletePiProvider({
    body: input,
    params: { providerId: input.providerId },
  })
