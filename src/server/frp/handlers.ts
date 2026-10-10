import { toTaskHttpResponse } from "@server/common/tasks/response"
import type { TaskRuntime } from "@server/tasks/runtime"
import {
  type ActionResponse,
  contract,
  TASK_REQUEST_ID_HEADER,
} from "@shared/api-contract"
import { ActionResponseSchema } from "@shared/api-contract/schemas/common"
import { describeError } from "@shared/format"
import { initServer } from "@ts-rest/express"
import { probeFrpProxy, readFrpConfig } from "./service"
import { FRP_SAVE_KIND, frpConfigTaskTarget } from "./task"

const s = initServer()

/** 只挑本功能的路由注册，其余端由各自 handler 提供并在 app.ts 合并。 */
export const frpContract = {
  getFrpConfig: contract.getFrpConfig,
  saveFrpConfig: contract.saveFrpConfig,
  probeFrpProxy: contract.probeFrpProxy,
}

/**
 * 保存配置也是写操作：经统一运行器提交，请求标识由契约 headers 强制校验。
 * 完成结果必须过契约校验才能作为 200 返回。
 */
export const createFrpRouter = (runtime: TaskRuntime) =>
  s.router(frpContract, {
    getFrpConfig: async () => {
      try {
        return { status: 200 as const, body: await readFrpConfig() }
      } catch (error) {
        return { status: 500 as const, body: { message: describeError(error) } }
      }
    },

    saveFrpConfig: async ({ headers, body }) => {
      try {
        const outcome = await runtime.runner.submit<ActionResponse>({
          kind: FRP_SAVE_KIND,
          target: frpConfigTaskTarget(),
          payload: body,
          requestId: headers[TASK_REQUEST_ID_HEADER],
          toCompletedResponse: (result) => {
            const parsed = ActionResponseSchema.safeParse(result.result)
            if (!parsed.success) {
              throw new Error("保存结果不符合契约，无法作为完成结果返回")
            }
            return { status: 200, body: parsed.data }
          },
        })
        return toTaskHttpResponse(outcome, 200)
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
