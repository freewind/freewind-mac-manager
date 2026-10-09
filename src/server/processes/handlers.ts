import os from "node:os"
import { initServer } from "@ts-rest/express"
import { contract } from "@shared/api-contract"
import { collectMachineOverview } from "@server/common/collect"
import { killProcesses } from "@server/common/kill"
import { collectProcesses } from "./collect"

const s = initServer()

/** 只挑本功能的路由注册，其余端由各自 handler 提供并在 app.ts 分别挂载。 */
export const processesContract = {
  listProcesses: contract.listProcesses,
  killProcesses: contract.killProcesses,
}

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const processesRouter = s.router(processesContract, {
  listProcesses: async () => {
    try {
      const [processes, overview] = await Promise.all([
        collectProcesses(),
        collectMachineOverview(),
      ])
      return {
        status: 200,
        body: { processes, overview, currentUser: os.userInfo().username },
      }
    } catch (error) {
      return { status: 500, body: { message: toMessage(error) } }
    }
  },

  killProcesses: async ({ body }) => ({
    status: 200,
    body: killProcesses(body.pids, body.force ?? false),
  }),
})
