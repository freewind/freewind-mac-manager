import { ApiPath, toContractPath } from "@shared/api-path"
import { c } from "../init"
import {
  ActionResponseSchema,
  ApiErrorSchema,
  TaskAcceptedSchema,
  TaskRequestIdHeadersSchema,
} from "../schemas/common"
import {
  DeleteScansQuerySchema,
  EntriesQuerySchema,
  EntriesResponseSchema,
  EntryPathBodySchema,
  EntryPathQuerySchema,
  ScansResponseSchema,
  ScanTaskResultSchema,
  TreeQuerySchema,
  TreeResponseSchema,
} from "../schemas/disk-growth"
import { DiskSnapshotDeleteResultSchema } from "../schemas/tasks"

const errorResponses = {
  400: ApiErrorSchema,
  500: ApiErrorSchema,
} as const

export const diskGrowthRoutes = {
  listScans: {
    method: "GET",
    path: toContractPath(ApiPath.diskGrowthScans),
    responses: {
      200: ScansResponseSchema,
      ...errorResponses,
    },
  },
  listEntries: {
    method: "GET",
    path: toContractPath(ApiPath.diskGrowthEntries),
    query: EntriesQuerySchema,
    responses: {
      200: EntriesResponseSchema,
      ...errorResponses,
    },
  },
  subtree: {
    method: "GET",
    path: toContractPath(ApiPath.diskGrowthTree),
    query: TreeQuerySchema,
    responses: {
      200: TreeResponseSchema,
      ...errorResponses,
    },
  },
  // 扫描是长任务：阈值内完成返回 201 与快照信息，否则返回 202 与任务标识。
  // 请求标识由契约强制要求，客户端据此复用任务，网络重试不会变成第二次扫描。
  startScan: {
    method: "POST",
    path: toContractPath(ApiPath.diskGrowthScan),
    body: c.noBody(),
    headers: TaskRequestIdHeadersSchema,
    responses: {
      201: ScanTaskResultSchema,
      202: TaskAcceptedSchema,
      409: ApiErrorSchema,
      ...errorResponses,
    },
  },
  revealEntry: {
    method: "POST",
    path: toContractPath(ApiPath.diskGrowthReveal),
    body: EntryPathBodySchema,
    responses: {
      202: ActionResponseSchema,
      ...errorResponses,
    },
  },
  // 快照明细可能很多，删除是一次同步写库的重活：同样按长任务处理。
  deleteScans: {
    method: "DELETE",
    path: toContractPath(ApiPath.diskGrowthScans),
    query: DeleteScansQuerySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: {
      200: DiskSnapshotDeleteResultSchema,
      202: TaskAcceptedSchema,
      409: ApiErrorSchema,
      ...errorResponses,
    },
  },
  trashEntry: {
    method: "DELETE",
    path: toContractPath(ApiPath.diskGrowthEntry),
    query: EntryPathQuerySchema,
    responses: {
      202: ActionResponseSchema,
      ...errorResponses,
    },
  },
} as const
