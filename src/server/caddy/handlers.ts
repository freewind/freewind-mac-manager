import { publicSystemError } from "@server/common/public-error"
import { contract } from "@shared/api-contract"
import { initServer } from "@ts-rest/express"
import {
  createCaddyRule,
  deleteCaddyRule,
  importCaddyRulesFromFile,
  readCaddyRules,
  readCaddyStatus,
  updateCaddyRule,
} from "./service"

const s = initServer()

/** 只挑本功能的路由注册，其余端由各自 handler 提供并在 app.ts 合并。 */
export const caddyContract = {
  getCaddyStatus: contract.getCaddyStatus,
  getCaddyRules: contract.getCaddyRules,
  createCaddyRule: contract.createCaddyRule,
  updateCaddyRule: contract.updateCaddyRule,
  deleteCaddyRule: contract.deleteCaddyRule,
  importCaddyRules: contract.importCaddyRules,
}

/**
 * 两个读端点不经过任务运行时；规则写入只改数据库、是快速本地写，
 * 也不走任务运行时（改配置文件的应用动作在另一个任务里）。
 */
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

  createCaddyRule: async ({ body }) => {
    try {
      return { status: 201 as const, body: createCaddyRule(body) }
    } catch (error) {
      return publicSystemError(error)
    }
  },

  updateCaddyRule: async ({ params, body }) => {
    try {
      return { status: 200 as const, body: updateCaddyRule(params.id, body) }
    } catch (error) {
      return publicSystemError(error)
    }
  },

  deleteCaddyRule: async ({ params }) => {
    try {
      deleteCaddyRule(params.id)
      return { status: 204 as const, body: null }
    } catch (error) {
      return publicSystemError(error)
    }
  },

  importCaddyRules: async () => {
    try {
      return { status: 200 as const, body: await importCaddyRulesFromFile() }
    } catch (error) {
      return publicSystemError(error)
    }
  },
})
