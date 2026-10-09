import { initServer } from "@ts-rest/express"
import { contract } from "@shared/api-contract"
import { describeError } from "@shared/format"
import { probeFrpProxy, readFrpConfig, saveFrpConfig } from "./service"

const s = initServer()

/** 只挑本功能的路由注册，其余端由各自 handler 提供并在 app.ts 合并。 */
export const frpContract = {
  getFrpConfig: contract.getFrpConfig,
  saveFrpConfig: contract.saveFrpConfig,
  probeFrpProxy: contract.probeFrpProxy,
}

export const frpRouter = s.router(frpContract, {
  getFrpConfig: async () => {
    try {
      return { status: 200 as const, body: await readFrpConfig() }
    } catch (error) {
      return { status: 500 as const, body: { message: describeError(error) } }
    }
  },

  saveFrpConfig: async ({ body }) => {
    try {
      return {
        status: 200 as const,
        body: { message: await saveFrpConfig(body) },
      }
    } catch (error) {
      return { status: 400 as const, body: { message: describeError(error) } }
    }
  },

  probeFrpProxy: async ({ body }) => {
    try {
      return { status: 200 as const, body: await probeFrpProxy(body) }
    } catch (error) {
      return { status: 400 as const, body: { message: describeError(error) } }
    }
  },
})
