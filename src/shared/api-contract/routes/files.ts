import { API_BASE, ApiPath, toContractPath } from "@shared/api-path"
import { z } from "zod"
import { c } from "../init"
import { ApiErrorSchema } from "../schemas/disk-growth"
import {
  CreateEntryBodySchema,
  DirectoryResponseSchema,
  FileContentResponseSchema,
  OkResponseSchema,
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
    path: toContractPath(ApiPath[`${API_BASE}/files/directory`]),
    query: PathQuerySchema,
    responses: {
      200: DirectoryResponseSchema,
      ...errorResponses,
    },
  },
  createDirectory: {
    method: "POST",
    path: toContractPath(ApiPath[`${API_BASE}/files/directories`]),
    body: CreateEntryBodySchema,
    responses: {
      200: OkResponseSchema,
      ...errorResponses,
    },
  },
  createFile: {
    method: "POST",
    path: toContractPath(ApiPath[`${API_BASE}/files/entries`]),
    body: CreateEntryBodySchema,
    responses: {
      200: OkResponseSchema,
      ...errorResponses,
    },
  },
  renameEntry: {
    method: "PUT",
    path: toContractPath(ApiPath[`${API_BASE}/files/entries/name`]),
    body: RenameEntryBodySchema,
    responses: {
      200: OkResponseSchema,
      ...errorResponses,
    },
  },
  deleteEntries: {
    method: "DELETE",
    path: toContractPath(ApiPath[`${API_BASE}/files/entries`]),
    query: PathsQuerySchema,
    responses: {
      200: OkResponseSchema,
      ...errorResponses,
    },
  },
  copyEntries: {
    method: "POST",
    path: toContractPath(ApiPath[`${API_BASE}/files/entries/copy`]),
    body: TransferEntriesBodySchema,
    responses: {
      200: OkResponseSchema,
      ...errorResponses,
    },
  },
  moveEntries: {
    method: "POST",
    path: toContractPath(ApiPath[`${API_BASE}/files/entries/move`]),
    body: TransferEntriesBodySchema,
    responses: {
      200: OkResponseSchema,
      ...errorResponses,
    },
  },
  readFileContent: {
    method: "GET",
    path: toContractPath(ApiPath[`${API_BASE}/files/content`]),
    query: PathQuerySchema,
    responses: {
      200: FileContentResponseSchema,
      ...errorResponses,
    },
  },
  writeFileContent: {
    method: "PUT",
    path: toContractPath(ApiPath[`${API_BASE}/files/content`]),
    body: SaveFileContentBodySchema,
    responses: {
      200: OkResponseSchema,
      ...errorResponses,
    },
  },
  downloadFile: {
    method: "GET",
    path: toContractPath(ApiPath[`${API_BASE}/files/download`]),
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
