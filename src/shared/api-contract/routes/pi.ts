import { ApiPath, toContractPath } from "@shared/api-path"
import { ApiErrorSchema } from "../schemas/common"
import {
  PiModelsResponseSchema,
  PiProviderDeleteBodySchema,
  PiProviderIdSchema,
  PiProviderMutationSchema,
  PiProviderWriteResultSchema,
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
  deletePiProvider: {
    method: "DELETE",
    path: toContractPath(ApiPath.piProvider),
    pathParams: PiProviderIdSchema,
    body: PiProviderDeleteBodySchema,
    responses: { 204: null, ...errorResponses },
  },
} as const
