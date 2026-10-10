import { ApiPath, toContractPath } from "@shared/api-path"
import { z } from "zod"
import { c } from "../init"
import {
  ActionResponseSchema,
  ApiErrorSchema,
  TaskAcceptedSchema,
  TaskRequestIdHeadersSchema,
} from "../schemas/common"
import {
  CreateEntryBodySchema,
  DirectoryResponseSchema,
  FileBatchResultSchema,
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
  // 与批量任务共用同一把目标锁：同目录下不会一边删一边建。
  createDirectory: {
    method: "POST",
    path: toContractPath(ApiPath.filesDirectories),
    body: CreateEntryBodySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: {
      200: ActionResponseSchema,
      202: TaskAcceptedSchema,
      409: ApiErrorSchema,
      ...errorResponses,
    },
  },
  createFile: {
    method: "POST",
    path: toContractPath(ApiPath.filesEntries),
    body: CreateEntryBodySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: {
      200: ActionResponseSchema,
      202: TaskAcceptedSchema,
      409: ApiErrorSchema,
      ...errorResponses,
    },
  },
  renameEntry: {
    method: "PUT",
    path: toContractPath(ApiPath.filesEntryName),
    body: RenameEntryBodySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: {
      200: ActionResponseSchema,
      202: TaskAcceptedSchema,
      409: ApiErrorSchema,
      ...errorResponses,
    },
  },
  // 三个批量操作都可能很久：请求标识由契约强制要求，完成返回逐项结果，未完成返回 202。
  deleteEntries: {
    method: "DELETE",
    path: toContractPath(ApiPath.filesEntries),
    query: PathsQuerySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: {
      200: FileBatchResultSchema,
      202: TaskAcceptedSchema,
      409: ApiErrorSchema,
      ...errorResponses,
    },
  },
  copyEntries: {
    method: "POST",
    path: toContractPath(ApiPath.filesEntriesCopy),
    body: TransferEntriesBodySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: {
      200: FileBatchResultSchema,
      202: TaskAcceptedSchema,
      409: ApiErrorSchema,
      ...errorResponses,
    },
  },
  moveEntries: {
    method: "POST",
    path: toContractPath(ApiPath.filesEntriesMove),
    body: TransferEntriesBodySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: {
      200: FileBatchResultSchema,
      202: TaskAcceptedSchema,
      409: ApiErrorSchema,
      ...errorResponses,
    },
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
    headers: TaskRequestIdHeadersSchema,
    responses: {
      200: ActionResponseSchema,
      202: TaskAcceptedSchema,
      409: ApiErrorSchema,
      ...errorResponses,
    },
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
