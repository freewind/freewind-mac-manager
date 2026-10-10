import { ApiPath, toContractPath } from "@shared/api-path"
import { c } from "../init"
import {
  ApiErrorSchema,
  KillProcessesBodySchema,
  KillProcessesResponseSchema,
  TaskAcceptedSchema,
  TaskRequestIdHeadersSchema,
} from "../schemas/common"
import {
  DeleteSnapshotsQuerySchema,
  MergeSnapshotsBodySchema,
  SnapshotMutationResultSchema,
  SnapshotSaveResultSchema,
  TrafficGroupsQuerySchema,
  TrafficGroupsResponseSchema,
  TrafficSnapshotsResponseSchema,
  TrafficStatusSchema,
} from "../schemas/traffic"

const errorResponses = {
  400: ApiErrorSchema,
  500: ApiErrorSchema,
} as const

export const trafficRoutes = {
  getTrafficStatus: {
    method: "GET",
    path: toContractPath(ApiPath.trafficStatus),
    responses: {
      200: TrafficStatusSchema,
      ...errorResponses,
    },
  },
  listTrafficSnapshots: {
    method: "GET",
    path: toContractPath(ApiPath.trafficSnapshots),
    responses: {
      200: TrafficSnapshotsResponseSchema,
      ...errorResponses,
    },
  },
  listTrafficGroups: {
    method: "GET",
    path: toContractPath(ApiPath.trafficGroups),
    query: TrafficGroupsQuerySchema,
    responses: {
      200: TrafficGroupsResponseSchema,
      ...errorResponses,
    },
  },
  // 保存、合并、删除都会重算增量链，因此共用一把域级锁，并且都是长任务。
  createTrafficSnapshot: {
    method: "POST",
    path: toContractPath(ApiPath.trafficSnapshots),
    body: c.noBody(),
    headers: TaskRequestIdHeadersSchema,
    responses: {
      201: SnapshotSaveResultSchema,
      202: TaskAcceptedSchema,
      409: ApiErrorSchema,
      ...errorResponses,
    },
  },
  mergeTrafficSnapshots: {
    method: "PUT",
    path: toContractPath(ApiPath.trafficSnapshotsMerge),
    body: MergeSnapshotsBodySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: {
      200: SnapshotMutationResultSchema,
      202: TaskAcceptedSchema,
      409: ApiErrorSchema,
      ...errorResponses,
    },
  },
  deleteTrafficSnapshots: {
    method: "DELETE",
    path: toContractPath(ApiPath.trafficSnapshots),
    query: DeleteSnapshotsQuerySchema,
    headers: TaskRequestIdHeadersSchema,
    responses: {
      200: SnapshotMutationResultSchema,
      202: TaskAcceptedSchema,
      409: ApiErrorSchema,
      ...errorResponses,
    },
  },
  killTrafficProcesses: {
    method: "POST",
    path: toContractPath(ApiPath.trafficProcessesKill),
    body: KillProcessesBodySchema,
    responses: {
      200: KillProcessesResponseSchema,
      ...errorResponses,
    },
  },
} as const
