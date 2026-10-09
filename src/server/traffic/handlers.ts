import { killProcesses } from "@server/common/kill"
import { contract } from "@shared/api-contract"
import { describeError } from "@shared/format"
import { initServer } from "@ts-rest/express"
import {
  captureSnapshot,
  deleteSnapshots,
  getTrafficStatus,
  groupsForSnapshots,
  listSnapshots,
  mergeSnapshots,
  realtimeGroups,
} from "./service"

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

export const trafficRouter = s.router(trafficContract, {
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

  createTrafficSnapshot: async () => {
    try {
      return {
        status: 201,
        body: { snapshot: await captureSnapshot("manual") },
      }
    } catch (error) {
      return { status: 500, body: { message: describeError(error) } }
    }
  },

  mergeTrafficSnapshots: async ({ body }) => {
    try {
      return {
        status: 200,
        body: { snapshots: await mergeSnapshots(body.ids) },
      }
    } catch (error) {
      return { status: 500, body: { message: describeError(error) } }
    }
  },

  deleteTrafficSnapshots: async ({ query }) => {
    try {
      return {
        status: 200,
        body: { snapshots: await deleteSnapshots(query.ids) },
      }
    } catch (error) {
      return { status: 500, body: { message: describeError(error) } }
    }
  },

  killTrafficProcesses: async ({ body }) => ({
    status: 200,
    body: killProcesses(body.pids, body.force ?? false),
  }),
})
