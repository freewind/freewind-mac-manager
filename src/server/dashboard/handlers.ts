import {
  collectListeningPorts,
  collectMachineOverview,
  collectTopProcesses,
} from "@server/common/collect"
import { contract } from "@shared/api-contract"
import { describeError } from "@shared/format"
import { initServer } from "@ts-rest/express"

const s = initServer()

/**
 * 只挑本功能的路由注册。共享 contract 里还有其他端（磁盘增长、流量监控）的路由，
 * 它们由各自的 handler 提供，在 app.ts 分别挂载。
 */
export const dashboardContract = {
  dashboardOverview: contract.dashboardOverview,
  listTopProcesses: contract.listTopProcesses,
  listListeningPorts: contract.listListeningPorts,
}

/**
 * 概览页自动刷新的秒数。
 *
 * 只有这一处定义：随 dashboardOverview 响应返回，前端轮询与页面文案都读它，
 * 不在前端另写一份。
 */
export const OVERVIEW_REFRESH_INTERVAL_SECONDS = 3

export const dashboardRouter = s.router(dashboardContract, {
  dashboardOverview: async () => {
    try {
      return {
        status: 200,
        body: {
          ...(await collectMachineOverview()),
          refreshIntervalSeconds: OVERVIEW_REFRESH_INTERVAL_SECONDS,
        },
      }
    } catch (error) {
      return { status: 500, body: { message: describeError(error) } }
    }
  },

  listTopProcesses: async ({ query }) => {
    try {
      return {
        status: 200,
        body: { processes: await collectTopProcesses(query.limit) },
      }
    } catch (error) {
      return { status: 500, body: { message: describeError(error) } }
    }
  },

  listListeningPorts: async () => {
    try {
      return { status: 200, body: { ports: await collectListeningPorts() } }
    } catch (error) {
      return { status: 500, body: { message: describeError(error) } }
    }
  },
})
