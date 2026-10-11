import { publicSystemError } from "@server/common/public-error"
import { toTaskHttpResponse } from "@server/common/tasks/response"
import type { TaskRuntime } from "@server/tasks/runtime"
import {
  contract,
  TASK_KINDS,
  TASK_REQUEST_ID_HEADER,
} from "@shared/api-contract"
import {
  PiBenchmarkRequestSchema,
  PiBenchmarkResultSchema,
} from "@shared/api-contract/schemas/pi"
import { PiLabResultSchema } from "@shared/api-contract/schemas/pi-lab"
import { initServer } from "@ts-rest/express"
import {
  deletePiBenchmarks,
  listPiBenchmarks,
  MAX_BENCHMARK_TIMEOUT_MS,
  piBenchmarkErrorMessage,
  piBenchmarkTarget,
} from "./benchmark"
import {
  addPiProvider,
  deletePiProvider,
  getPiSettings,
  listPiModels,
  savePiSettings,
  updatePiProvider,
} from "./config"
import {
  cancelLabRun,
  clearLabSession,
  labTarget,
  listLabRuns,
  readLabRun,
} from "./lab"

const s = initServer()

export const piContract = {
  startPiLab: contract.startPiLab,
  listPiLab: contract.listPiLab,
  readPiLab: contract.readPiLab,
  cancelPiLab: contract.cancelPiLab,
  clearPiLab: contract.clearPiLab,
  listPiModels: contract.listPiModels,
  addPiProvider: contract.addPiProvider,
  updatePiProvider: contract.updatePiProvider,
  deletePiProvider: contract.deletePiProvider,
  getPiSettings: contract.getPiSettings,
  savePiSettings: contract.savePiSettings,
  startPiBenchmark: contract.startPiBenchmark,
  listPiBenchmarks: contract.listPiBenchmarks,
  deletePiBenchmarks: contract.deletePiBenchmarks,
}

export const createPiRouter = (runtime: TaskRuntime) =>
  s.router(piContract, {
    startPiLab: async ({ body, headers }) => {
      try {
        const payload = { ...body, requestId: headers[TASK_REQUEST_ID_HEADER] }
        const outcome = await runtime.runner.submit({
          kind: TASK_KINDS.piLab,
          target: labTarget(payload),
          payload,
          requestId: payload.requestId,
          toCompletedResponse: (result) => ({
            status: 200,
            body: PiLabResultSchema.parse(result.result),
          }),
        })
        return toTaskHttpResponse(outcome, 200)
      } catch (error) {
        return publicSystemError(error)
      }
    },
    listPiLab: async () => {
      try {
        return { status: 200 as const, body: { runs: listLabRuns() } }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    readPiLab: async ({ params }) => {
      try {
        return { status: 200 as const, body: readLabRun(params.id) }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    cancelPiLab: async ({ params }) => {
      try {
        cancelLabRun(params.id)
        return { status: 204 as const, body: null }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    clearPiLab: async ({ body }) => {
      try {
        clearLabSession(body.sessionId)
        return { status: 204 as const, body: null }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    listPiModels: async () => {
      try {
        return { status: 200 as const, body: await listPiModels() }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    addPiProvider: async ({ body }) => {
      try {
        return { status: 201 as const, body: await addPiProvider(body) }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    updatePiProvider: async ({ params, body }) => {
      try {
        return {
          status: 200 as const,
          body: await updatePiProvider(params.providerId, body),
        }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    getPiSettings: async () => {
      try {
        return { status: 200 as const, body: await getPiSettings() }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    savePiSettings: async ({ body }) => {
      try {
        return { status: 200 as const, body: await savePiSettings(body) }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    deletePiProvider: async ({ params, body }) => {
      try {
        await deletePiProvider(params.providerId, body)
        return { status: 204 as const, body: null }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    startPiBenchmark: async ({ body, headers }) => {
      let requestId: string | undefined
      try {
        const parsed = PiBenchmarkRequestSchema.safeParse(body)
        if (!parsed.success)
          return { status: 400 as const, body: { message: "测速参数无效" } }
        const models = await listPiModels()
        const provider = models.providers.find(
          (item) => item.id === parsed.data.providerId
        )
        const model = provider?.provider.models.find(
          (item) => item.id === parsed.data.modelId
        )
        if (!provider || !model)
          return {
            status: 404 as const,
            body: { message: "Pi Provider 或模型不存在" },
          }
        if (!model.maxTokens)
          return {
            status: 400 as const,
            body: { message: "所选模型未声明 maxTokens，无法安全发起测速" },
          }
        if (
          !Number.isInteger(parsed.data.timeoutMs) ||
          parsed.data.timeoutMs > MAX_BENCHMARK_TIMEOUT_MS
        ) {
          return {
            status: 400 as const,
            body: { message: "测速时限超过允许上限" },
          }
        }
        const target = piBenchmarkTarget(
          parsed.data.providerId,
          parsed.data.modelId
        )
        requestId = headers[TASK_REQUEST_ID_HEADER]
        const outcome = await runtime.runner.submit({
          kind: TASK_KINDS.piBenchmark,
          target,
          lockTarget: target,
          requestId,
          payload: { ...parsed.data, requestId, maxTokens: model.maxTokens },
          toCompletedResponse: (task) => ({
            status: 200,
            body: PiBenchmarkResultSchema.parse(task.result),
          }),
        })
        const response = toTaskHttpResponse(outcome, 200)
        if (response.status === 409 && outcome.kind === "unknown") {
          return {
            ...response,
            body: {
              ...response.body,
              message:
                outcome.kind === "unknown"
                  ? piBenchmarkErrorMessage(null)
                  : response.body.message,
              requestId,
            },
          }
        }
        return response
      } catch (error) {
        const response = publicSystemError(error)
        return response
      }
    },
    listPiBenchmarks: async () => {
      try {
        return {
          status: 200 as const,
          body: { benchmarks: listPiBenchmarks() },
        }
      } catch (error) {
        return publicSystemError(error)
      }
    },
    deletePiBenchmarks: async ({ body }) => {
      try {
        deletePiBenchmarks(body)
        return { status: 204 as const, body: null }
      } catch (error) {
        return publicSystemError(error)
      }
    },
  })
