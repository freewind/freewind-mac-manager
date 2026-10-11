import type {
  PiBenchmarkList,
  PiBenchmarkRequest,
  PiBenchmarkResult,
  PiModelsResponse,
  PiProviderInput,
  PiSettingsInput,
  PiSettingsResponse,
} from "@shared/api-contract"
import { TaskRequestIdSchema } from "@shared/api-contract/schemas/common"
import {
  ApiRequestError,
  apiClient,
  newRequestId,
  taskRequestHeaders,
  unwrap,
} from "./client"
import type { Execution } from "./execution"
import { runExecution } from "./execution"

export const startPiBenchmark = async (
  input: PiBenchmarkRequest,
  requestId = newRequestId()
): Promise<Execution<PiBenchmarkResult>> => {
  try {
    return await runExecution<PiBenchmarkResult>(() =>
      apiClient.startPiBenchmark({
        body: input,
        headers: taskRequestHeaders(requestId),
      })
    )
  } catch (error) {
    if (error instanceof ApiRequestError && error.resultUnknown) {
      const body = error.responseBody
      const returnedId =
        typeof body === "object" && body !== null && "requestId" in body
          ? TaskRequestIdSchema.safeParse(body.requestId).data
          : undefined
      throw new ApiRequestError(
        error.message,
        error.status,
        error.responseBody,
        error,
        true,
        returnedId ?? requestId
      )
    }
    throw error
  }
}

export const fetchPiBenchmarks = async (): Promise<PiBenchmarkList> =>
  unwrap<PiBenchmarkList>(await apiClient.listPiBenchmarks())

export const deletePiBenchmarks = (ids: string[]) =>
  apiClient.deletePiBenchmarks({ body: { ids } })

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

export const fetchPiSettings = async (): Promise<PiSettingsResponse> =>
  unwrap<PiSettingsResponse>(await apiClient.getPiSettings())

export const savePiSettings = async (input: PiSettingsInput) =>
  apiClient.savePiSettings({ body: input })

export const deletePiProvider = async (input: {
  providerId: string
  signature: string
}) =>
  apiClient.deletePiProvider({
    body: input,
    params: { providerId: input.providerId },
  })
