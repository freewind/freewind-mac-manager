import { ApiPath, toContractPath } from "@shared/api-path"
import {
  ApiErrorSchema,
  TaskAcceptedSchema,
  TaskRequestIdHeadersSchema,
} from "../schemas/common"
import {
  PiBenchmarkDeleteSchema,
  PiBenchmarkErrorSchema,
  PiBenchmarkListSchema,
  PiBenchmarkRequestSchema,
  PiBenchmarkResultSchema,
  PiModelsResponseSchema,
  PiProviderApiKeySchema,
  PiProviderDeleteBodySchema,
  PiProviderIdSchema,
  PiProviderMutationSchema,
  PiProviderWriteResultSchema,
  PiSettingsMutationSchema,
  PiSettingsResponseSchema,
} from "../schemas/pi"
import {
  PiLabClearSchema,
  PiLabListSchema,
  PiLabPathSchema,
  PiLabRequestSchema,
  PiLabResultSchema,
} from "../schemas/pi-lab"

const errorResponses = {
  400: ApiErrorSchema,
  403: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  500: ApiErrorSchema,
} as const

export const piRoutes = {
  startPiLab: {
    method: "POST",
    path: toContractPath(ApiPath.piLabRuns),
    body: PiLabRequestSchema,
    headers: TaskRequestIdHeadersSchema,
    responses: {
      200: PiLabResultSchema,
      202: TaskAcceptedSchema,
      ...errorResponses,
    },
  },
  listPiLab: {
    method: "GET",
    path: toContractPath(ApiPath.piLabRuns),
    responses: { 200: PiLabListSchema, ...errorResponses },
  },
  readPiLab: {
    method: "GET",
    path: toContractPath(ApiPath.piLabRun),
    pathParams: PiLabPathSchema,
    responses: { 200: PiLabResultSchema, ...errorResponses },
  },
  cancelPiLab: {
    method: "POST",
    path: toContractPath(ApiPath.piLabCancel),
    pathParams: PiLabPathSchema,
    body: PiLabPathSchema,
    responses: { 204: null, ...errorResponses },
  },
  clearPiLab: {
    method: "DELETE",
    path: toContractPath(ApiPath.piLabSession),
    body: PiLabClearSchema,
    responses: { 204: null, ...errorResponses },
  },
  listPiModels: {
    method: "GET",
    path: toContractPath(ApiPath.piModels),
    responses: { 200: PiModelsResponseSchema, ...errorResponses },
  },
  addPiProvider: {
    method: "POST",
    path: toContractPath(ApiPath.piModels),
    body: PiProviderMutationSchema,
    responses: { 201: PiProviderWriteResultSchema, ...errorResponses },
  },
  updatePiProvider: {
    method: "PUT",
    path: toContractPath(ApiPath.piProvider),
    pathParams: PiProviderIdSchema,
    body: PiProviderMutationSchema,
    responses: { 200: PiProviderWriteResultSchema, ...errorResponses },
  },
  readPiProviderApiKey: {
    method: "GET",
    path: toContractPath(ApiPath.piProviderApiKey),
    pathParams: PiProviderIdSchema,
    responses: { 200: PiProviderApiKeySchema, ...errorResponses },
  },
  getPiSettings: {
    method: "GET",
    path: toContractPath(ApiPath.piSettings),
    responses: { 200: PiSettingsResponseSchema, ...errorResponses },
  },
  savePiSettings: {
    method: "PUT",
    path: toContractPath(ApiPath.piSettings),
    body: PiSettingsMutationSchema,
    responses: { 200: PiSettingsResponseSchema, ...errorResponses },
  },
  startPiBenchmark: {
    method: "POST",
    path: toContractPath(ApiPath.piBenchmarks),
    body: PiBenchmarkRequestSchema,
    headers: TaskRequestIdHeadersSchema,
    responses: {
      200: PiBenchmarkResultSchema,
      202: TaskAcceptedSchema,
      400: PiBenchmarkErrorSchema,
      403: PiBenchmarkErrorSchema,
      404: PiBenchmarkErrorSchema,
      409: PiBenchmarkErrorSchema,
      500: PiBenchmarkErrorSchema,
    },
  },
  listPiBenchmarks: {
    method: "GET",
    path: toContractPath(ApiPath.piBenchmarks),
    responses: { 200: PiBenchmarkListSchema, ...errorResponses },
  },
  deletePiBenchmarks: {
    method: "DELETE",
    path: toContractPath(ApiPath.piBenchmarks),
    body: PiBenchmarkDeleteSchema,
    responses: { 204: null, ...errorResponses },
  },
  deletePiProvider: {
    method: "DELETE",
    path: toContractPath(ApiPath.piProvider),
    pathParams: PiProviderIdSchema,
    body: PiProviderDeleteBodySchema,
    responses: { 204: null, ...errorResponses },
  },
} as const
