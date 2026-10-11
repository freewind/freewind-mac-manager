import { publicSystemError } from "@server/common/public-error"
import { contract } from "@shared/api-contract"
import { initServer } from "@ts-rest/express"
import { readCaddyRules, readCaddyStatus } from "./service"

const s = initServer()

/** 只挑本功能的路由注册，其余端由各自 handler 提供并在 app.ts 合并。 */
export const caddyContract = {
  getCaddyStatus: contract.getCaddyStatus,
  getCaddyRules: contract.getCaddyRules,
}

/** 两个端点都只读，不经过任务运行时。 */
export const caddyRouter = s.router(caddyContract, {
  getCaddyStatus: async () => {
    try {
      return { status: 200 as const, body: await readCaddyStatus() }
    } catch (error) {
      return publicSystemError(error)
    }
  },

  getCaddyRules: async () => {
    try {
      return { status: 200 as const, body: await readCaddyRules() }
    } catch (error) {
      return publicSystemError(error)
    }
  },
})
