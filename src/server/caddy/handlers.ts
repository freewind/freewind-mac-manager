import { publicSystemError } from "@server/common/public-error"
import { toTaskHttpResponse } from "@server/common/tasks/response"
import type { TaskRuntime } from "@server/tasks/runtime"
import {
  type CaddyApplyResult,
  contract,
  TASK_REQUEST_ID_HEADER,
} from "@shared/api-contract"
import { CaddyApplyResultSchema } from "@shared/api-contract/schemas/caddy"
import { initServer } from "@ts-rest/express"
import {
  assertCaddyApplyReady,
  createCaddyRule,
  deleteCaddyRule,
  importCaddyRulesFromFile,
  readCaddyRules,
  readCaddyStatus,
  readCaddyVersions,
  updateCaddyRule,
} from "./service"
import { getCaddyStore } from "./store"
import { CADDY_APPLY_KIND, caddyConfigTaskTarget } from "./task"

const s = initServer()

/** 只挑本功能的路由注册，其余端由各自 handler 提供并在 app.ts 合并。 */
export const caddyContract = {
  getCaddyStatus: contract.getCaddyStatus,
  getCaddyRules: contract.getCaddyRules,
  createCaddyRule: contract.createCaddyRule,
  updateCaddyRule: contract.updateCaddyRule,
  deleteCaddyRule: contract.deleteCaddyRule,
  importCaddyRules: contract.importCaddyRules,
  applyCaddyConfig: contract.applyCaddyConfig,
  listCaddyVersions: contract.listCaddyVersions,
  restoreCaddyVersion: contract.restoreCaddyVersion,
}

/** 完成结果必须过契约校验才能作为 200 返回。 */
const toApplyResponse = (
  result: unknown
): {
  status: 200
  body: CaddyApplyResult
} => {
  const parsed = CaddyApplyResultSchema.safeParse(result)
  if (!parsed.success) {
    throw new Error("应用结果不符合契约，无法作为完成结果返回")
  }
  return { status: 200, body: parsed.data }
}

/**
 * 规则写入只改数据库、是快速本地写，不走任务运行时；
 * 应用与恢复要改真实配置文件、必须进统一运行器（同目标互斥、可查询）。
 */
export const createCaddyRouter = (runtime: TaskRuntime) =>
  s.router(caddyContract, {
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

    listCaddyVersions: async () => ({
      status: 200 as const,
      body: readCaddyVersions(),
    }),

    applyCaddyConfig: async ({ headers, body }) => {
      try {
        // 先做不产生副作用的预检：被拒绝的请求不会留下任务记录。
        await assertCaddyApplyReady(
          undefined,
          undefined,
          undefined,
          body.expectedSignature
        )
        const outcome = await runtime.runner.submit<CaddyApplyResult>({
          kind: CADDY_APPLY_KIND,
          target: caddyConfigTaskTarget(),
          lockTarget: caddyConfigTaskTarget(),
          payload: {
            mode: "apply",
            expectedSignature: body.expectedSignature,
          },
          requestId: headers[TASK_REQUEST_ID_HEADER],
          toCompletedResponse: (result) => toApplyResponse(result.result),
        })
        return toTaskHttpResponse(outcome, 200)
      } catch (error) {
        return publicSystemError(error)
      }
    },

    restoreCaddyVersion: async ({ params, headers }) => {
      try {
        const store = getCaddyStore()
        if (store.findApplyRecord(params.id) === null) {
          return {
            status: 404 as const,
            body: { message: "找不到要恢复的版本" },
          }
        }
        await assertCaddyApplyReady(undefined, undefined, store)
        const outcome = await runtime.runner.submit<CaddyApplyResult>({
          kind: CADDY_APPLY_KIND,
          target: caddyConfigTaskTarget(),
          lockTarget: caddyConfigTaskTarget(),
          payload: { mode: "restore", versionId: params.id },
          requestId: headers[TASK_REQUEST_ID_HEADER],
          toCompletedResponse: (result) => toApplyResponse(result.result),
        })
        return toTaskHttpResponse(outcome, 200)
      } catch (error) {
        return publicSystemError(error)
      }
    },
  })
