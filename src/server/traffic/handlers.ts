import { killProcesses } from "@server/common/kill"
import {
  type TaskHttpResponse,
  toTaskHttpResponse,
} from "@server/common/tasks/response"
import type { TaskRuntime } from "@server/tasks/runtime"
import { contract, TASK_REQUEST_ID_HEADER } from "@shared/api-contract"
import {
  SnapshotMutationResultSchema,
  SnapshotSaveResultSchema,
} from "@shared/api-contract/schemas/traffic"
import { describeError } from "@shared/format"
import { initServer } from "@ts-rest/express"
import type { z } from "zod"
import {
  getTrafficStatus,
  groupsForSnapshots,
  listSnapshots,
  realtimeGroups,
} from "./service"
import {
  TRAFFIC_DELETE_KIND,
  TRAFFIC_MERGE_KIND,
  TRAFFIC_SAVE_KIND,
  trafficTaskTarget,
} from "./task"

const s = initServer()

/** 只挑本功能的路由注册，其余端由各自 handler 提供并在 app.ts 合并。 */
export const trafficContract = {
  getTrafficStatus: contract.getTrafficStatus,
  listTrafficSnapshots: contract.listTrafficSnapshots,
  listTrafficGroups: contract.listTrafficGroups,
  createTrafficSnapshot: contract.createTrafficSnapshot,
  mergeTrafficSnapshots: contract.mergeTrafficSnapshots,
  deleteTrafficSnapshots: contract.deleteTrafficSnapshots,
  killTrafficProcesses: contract.killTrafficProcesses,
}

/**
 * 提交一次快照写任务：完成结果必须通过契约校验才能作为 200/201 返回，
 * 未完成返回 202，冲突 409，真实失败 500。
 */
const submitSnapshotTask = async <TBody, TStatus extends 200 | 201>(
  runtime: TaskRuntime,
  options: {
    kind: string
    payload: unknown
    requestId: string
    schema: z.ZodType<TBody>
    completedStatus: TStatus
  }
): Promise<
  TaskHttpResponse<TBody, TStatus> | { status: 500; body: { message: string } }
> => {
  try {
    const outcome = await runtime.runner.submit<TBody>({
      kind: options.kind,
      target: trafficTaskTarget(),
      payload: options.payload,
      requestId: options.requestId,
      toCompletedResponse: (result) => {
        const parsed = options.schema.safeParse(result.result)
        if (!parsed.success) {
          throw new Error("快照操作结果不符合契约，无法作为完成结果返回")
        }
        return { status: options.completedStatus, body: parsed.data }
      },
    })
    return toTaskHttpResponse(outcome, options.completedStatus)
  } catch (error) {
    return { status: 500 as const, body: { message: describeError(error) } }
  }
}

export const createTrafficRouter = (runtime: TaskRuntime) =>
  s.router(trafficContract, {
    getTrafficStatus: async () => ({
      status: 200,
      body: getTrafficStatus(),
    }),

    listTrafficSnapshots: async () => {
      try {
        return { status: 200, body: { snapshots: await listSnapshots() } }
      } catch (error) {
        return { status: 500, body: { message: describeError(error) } }
      }
    },

    listTrafficGroups: async ({ query }) => {
      try {
        const result =
          query.realtime === "1"
            ? await realtimeGroups()
            : await groupsForSnapshots(query.ids ?? [])
        return { status: 200, body: result }
      } catch (error) {
        return { status: 500, body: { message: describeError(error) } }
      }
    },

    createTrafficSnapshot: async ({ headers }) =>
      submitSnapshotTask(runtime, {
        kind: TRAFFIC_SAVE_KIND,
        payload: { savedBy: "manual" },
        requestId: headers[TASK_REQUEST_ID_HEADER],
        schema: SnapshotSaveResultSchema,
        completedStatus: 201,
      }),

    mergeTrafficSnapshots: async ({ headers, body }) =>
      submitSnapshotTask(runtime, {
        kind: TRAFFIC_MERGE_KIND,
        payload: { ids: body.ids },
        requestId: headers[TASK_REQUEST_ID_HEADER],
        schema: SnapshotMutationResultSchema,
        completedStatus: 200,
      }),

    deleteTrafficSnapshots: async ({ headers, query }) =>
      submitSnapshotTask(runtime, {
        kind: TRAFFIC_DELETE_KIND,
        payload: { ids: query.ids },
        requestId: headers[TASK_REQUEST_ID_HEADER],
        schema: SnapshotMutationResultSchema,
        completedStatus: 200,
      }),

    killTrafficProcesses: async ({ body }) => ({
      status: 200,
      body: killProcesses(body.pids, body.force ?? false),
    }),
  })
