import { API_BASE, ApiPath, toContractPath } from "@shared/api-path"
import { c } from "../init"
import { ApiErrorSchema } from "../schemas/common"
import {
  KillProcessesBodySchema,
  KillProcessesResponseSchema,
} from "../schemas/common"
import {
  DeleteSnapshotsQuerySchema,
  MergeSnapshotsBodySchema,
  TrafficGroupsQuerySchema,
  TrafficGroupsResponseSchema,
  TrafficSnapshotResponseSchema,
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
    path: toContractPath(ApiPath[`${API_BASE}/traffic/status`]),
    responses: {
      200: TrafficStatusSchema,
      ...errorResponses,
    },
  },
  listTrafficSnapshots: {
    method: "GET",
    path: toContractPath(ApiPath[`${API_BASE}/traffic/snapshots`]),
    responses: {
      200: TrafficSnapshotsResponseSchema,
      ...errorResponses,
    },
  },
  listTrafficGroups: {
    method: "GET",
    path: toContractPath(ApiPath[`${API_BASE}/traffic/groups`]),
    query: TrafficGroupsQuerySchema,
    responses: {
      200: TrafficGroupsResponseSchema,
      ...errorResponses,
    },
  },
  createTrafficSnapshot: {
    method: "POST",
    path: toContractPath(ApiPath[`${API_BASE}/traffic/snapshots`]),
    body: c.noBody(),
    responses: {
      201: TrafficSnapshotResponseSchema,
      ...errorResponses,
    },
  },
  mergeTrafficSnapshots: {
    method: "PUT",
    path: toContractPath(ApiPath[`${API_BASE}/traffic/snapshots/merge`]),
    body: MergeSnapshotsBodySchema,
    responses: {
      200: TrafficSnapshotsResponseSchema,
      ...errorResponses,
    },
  },
  deleteTrafficSnapshots: {
    method: "DELETE",
    path: toContractPath(ApiPath[`${API_BASE}/traffic/snapshots`]),
    query: DeleteSnapshotsQuerySchema,
    responses: {
      200: TrafficSnapshotsResponseSchema,
      ...errorResponses,
    },
  },
  killTrafficProcesses: {
    method: "POST",
    path: toContractPath(ApiPath[`${API_BASE}/traffic/processes/kill`]),
    body: KillProcessesBodySchema,
    responses: {
      200: KillProcessesResponseSchema,
      ...errorResponses,
    },
  },
} as const
