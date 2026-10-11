import { ApiPath, toContractPath } from "@shared/api-path"
import { ApiErrorSchema } from "../schemas/common"
import {
  PiModelsResponseSchema,
  PiProviderDeleteBodySchema,
  PiProviderIdSchema,
  PiProviderMutationSchema,
  PiProviderWriteResultSchema,
  PiSettingsMutationSchema,
  PiSettingsResponseSchema,
} from "../schemas/pi"

const errorResponses = {
  400: ApiErrorSchema,
  403: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  500: ApiErrorSchema,
} as const

export const piRoutes = {
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
  deletePiProvider: {
    method: "DELETE",
    path: toContractPath(ApiPath.piProvider),
    pathParams: PiProviderIdSchema,
    body: PiProviderDeleteBodySchema,
    responses: { 204: null, ...errorResponses },
  },
} as const
