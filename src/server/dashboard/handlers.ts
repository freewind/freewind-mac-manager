import { initServer } from "@ts-rest/express"
import { contract } from "@shared/api-contract"
import {
  collectListeningPorts,
  collectMachineOverview,
  collectTopProcesses,
} from "./collect"

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

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const dashboardRouter = s.router(dashboardContract, {
  dashboardOverview: async () => {
    try {
      return { status: 200, body: await collectMachineOverview() }
    } catch (error) {
      return { status: 500, body: { message: message(error) } }
    }
  },

  listTopProcesses: async ({ query }) => {
    try {
      return {
        status: 200,
        body: { processes: await collectTopProcesses(query.limit) },
      }
    } catch (error) {
      return { status: 500, body: { message: message(error) } }
    }
  },

  listListeningPorts: async () => {
    try {
      return { status: 200, body: { ports: await collectListeningPorts() } }
    } catch (error) {
      return { status: 500, body: { message: message(error) } }
    }
  },
})
