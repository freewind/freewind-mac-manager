import { initServer } from "@ts-rest/express"
import { contract } from "@shared/api-contract"
import {
  listSystemServices,
  loadService,
  restartService,
  revealService,
  RootRequiredError,
  setServiceEnabled,
  startService,
  stopService,
  uninstallService,
} from "./service"

const s = initServer()

/** 只挑本功能的路由注册，其余端由各自的 handler 提供。 */
export const systemServicesContract = {
  listSystemServices: contract.listSystemServices,
  startSystemService: contract.startSystemService,
  stopSystemService: contract.stopSystemService,
  restartSystemService: contract.restartSystemService,
  loadSystemService: contract.loadSystemService,
  uninstallSystemService: contract.uninstallSystemService,
  setSystemServiceEnabled: contract.setSystemServiceEnabled,
  revealSystemService: contract.revealSystemService,
}

/** 需要 root 的服务回 403，其余命令错误回 400，文案直接用命令输出。 */
const fail = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return error instanceof RootRequiredError
    ? { status: 403 as const, body: { message } }
    : { status: 400 as const, body: { message } }
}

export const systemServicesRouter = s.router(systemServicesContract, {
  listSystemServices: async () => ({
    status: 200,
    body: await listSystemServices(),
  }),

  startSystemService: async ({ body }) => {
    try {
      return {
        status: 202 as const,
        body: { message: await startService(body) },
      }
    } catch (error) {
      return fail(error)
    }
  },

  stopSystemService: async ({ query }) => {
    try {
      return {
        status: 202 as const,
        body: { message: await stopService(query) },
      }
    } catch (error) {
      return fail(error)
    }
  },

  restartSystemService: async ({ body }) => {
    try {
      return {
        status: 202 as const,
        body: { message: await restartService(body) },
      }
    } catch (error) {
      return fail(error)
    }
  },

  loadSystemService: async ({ body }) => {
    try {
      return {
        status: 202 as const,
        body: { message: await loadService(body) },
      }
    } catch (error) {
      return fail(error)
    }
  },

  uninstallSystemService: async ({ query }) => {
    try {
      return {
        status: 202 as const,
        body: { message: await uninstallService(query) },
      }
    } catch (error) {
      return fail(error)
    }
  },

  setSystemServiceEnabled: async ({ body }) => {
    try {
      return {
        status: 202 as const,
        body: { message: await setServiceEnabled(body) },
      }
    } catch (error) {
      return fail(error)
    }
  },

  revealSystemService: async ({ body }) => {
    try {
      return {
        status: 202 as const,
        body: { message: await revealService(body) },
      }
    } catch (error) {
      return fail(error)
    }
  },
})
