import { initServer, type AppRouteImplementation } from "@ts-rest/express"
import { contract } from "@shared/api-contract"
import { describeError } from "@shared/format"
import { collectPortBindings } from "./scanner"
import { killPortProcesses } from "./process-actions"

const s = initServer()

const listPortBindings: AppRouteImplementation<
  typeof contract.listPortBindings
> = async () => {
  try {
    return { status: 200, body: { bindings: await collectPortBindings() } }
  } catch (error) {
    return {
      status: 500 as const,
      body: {
        message: describeError(error),
      },
    }
  }
}

const killPortProcessesHandler: AppRouteImplementation<
  typeof contract.killPortProcesses
> = async ({ body }) => {
  try {
    return {
      status: 200,
      body: { results: await killPortProcesses(body.port, body.pids) },
    }
  } catch (error) {
    return {
      status: 400 as const,
      body: {
        message: describeError(error),
      },
    }
  }
}

/** 端口域的路由实现；既可并入共享 router，也可由本功能单独挂载。 */
export const portsHandlers = {
  listPortBindings,
  killPortProcesses: killPortProcessesHandler,
}

/** 只挑本功能的路由注册；共享 contract 里其他端的路由由各自 handler 提供。 */
export const portsContract = {
  listPortBindings: contract.listPortBindings,
  killPortProcesses: contract.killPortProcesses,
}

export const portsRouter = s.router(portsContract, portsHandlers)
