import { ApiPath, toContractPath } from "@shared/api-path"
import { z } from "zod"
import { c } from "../init"
import { ActionResponseSchema, ApiErrorSchema } from "../schemas/common"
import {
  CreateEntryBodySchema,
  DirectoryResponseSchema,
  FileContentResponseSchema,
  PathQuerySchema,
  PathsQuerySchema,
  RenameEntryBodySchema,
  SaveFileContentBodySchema,
  TransferEntriesBodySchema,
} from "../schemas/files"

const errorResponses = {
  400: ApiErrorSchema,
  500: ApiErrorSchema,
} as const

export const filesRoutes = {
  listDirectory: {
    method: "GET",
    path: toContractPath(ApiPath.filesDirectory),
    query: PathQuerySchema,
    responses: { 200: DirectoryResponseSchema, ...errorResponses },
  },
  createDirectory: {
    method: "POST",
    path: toContractPath(ApiPath.filesDirectories),
    body: CreateEntryBodySchema,
    responses: { 200: ActionResponseSchema, ...errorResponses },
  },
  createFile: {
    method: "POST",
    path: toContractPath(ApiPath.filesEntries),
    body: CreateEntryBodySchema,
    responses: { 200: ActionResponseSchema, ...errorResponses },
  },
  renameEntry: {
    method: "PUT",
    path: toContractPath(ApiPath.filesEntryName),
    body: RenameEntryBodySchema,
    responses: { 200: ActionResponseSchema, ...errorResponses },
  },
  deleteEntries: {
    method: "DELETE",
    path: toContractPath(ApiPath.filesEntries),
    query: PathsQuerySchema,
    responses: { 200: ActionResponseSchema, ...errorResponses },
  },
  copyEntries: {
    method: "POST",
    path: toContractPath(ApiPath.filesEntriesCopy),
    body: TransferEntriesBodySchema,
    responses: { 200: ActionResponseSchema, ...errorResponses },
  },
  moveEntries: {
    method: "POST",
    path: toContractPath(ApiPath.filesEntriesMove),
    body: TransferEntriesBodySchema,
    responses: { 200: ActionResponseSchema, ...errorResponses },
  },
  readFileContent: {
    method: "GET",
    path: toContractPath(ApiPath.filesContent),
    query: PathQuerySchema,
    responses: { 200: FileContentResponseSchema, ...errorResponses },
  },
  writeFileContent: {
    method: "PUT",
    path: toContractPath(ApiPath.filesContent),
    body: SaveFileContentBodySchema,
    responses: { 200: ActionResponseSchema, ...errorResponses },
  },
  downloadFile: {
    method: "GET",
    path: toContractPath(ApiPath.filesDownload),
    query: PathQuerySchema,
    responses: {
      200: c.otherResponse({
        contentType: "application/octet-stream",
        body: z.any(),
      }),
      ...errorResponses,
    },
  },
} as const
