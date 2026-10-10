import { toTaskHttpResponse } from "@server/common/tasks/response"
import type { TaskRuntime } from "@server/tasks/runtime"
import {
  type ActionResponse,
  contract,
  type ServiceDomain,
  TASK_REQUEST_ID_HEADER,
} from "@shared/api-contract"
import { ActionResponseSchema } from "@shared/api-contract/schemas/common"
import { describeError } from "@shared/format"
import { initServer } from "@ts-rest/express"
import { listSystemServices, RootRequiredError } from "./service"
import {
  SERVICE_ACTION_KIND,
  type ServiceActionName,
  serviceTargetOf,
} from "./task"

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
  const message = describeError(error)
  return error instanceof RootRequiredError
    ? { status: 403 as const, body: { message } }
    : { status: 400 as const, body: { message } }
}

/**
 * 服务动作经统一运行器提交：请求标识由契约 headers 强制校验，
 * 同域同 label 的服务同一时刻只做一个动作。
 */
const submitServiceAction = async (
  runtime: TaskRuntime,
  options: {
    action: ServiceActionName
    target: { label: string; domain: ServiceDomain }
    requestId: string
  }
) => {
  try {
    const outcome = await runtime.runner.submit<ActionResponse>({
      kind: SERVICE_ACTION_KIND,
      target: serviceTargetOf(options.target.domain, options.target.label),
      payload: { action: options.action, ...options.target },
      requestId: options.requestId,
      toCompletedResponse: (result) => {
        const parsed = ActionResponseSchema.safeParse(result.result)
        if (!parsed.success) {
          throw new Error("服务动作结果不符合契约，无法作为完成结果返回")
        }
        return { status: 200, body: parsed.data }
      },
    })
    return toTaskHttpResponse(outcome, 200)
  } catch (error) {
    return fail(error)
  }
}

export const createSystemServicesRouter = (runtime: TaskRuntime) =>
  s.router(systemServicesContract, {
    listSystemServices: async () => ({
      status: 200,
      body: await listSystemServices(),
    }),

    startSystemService: async ({ headers, body }) =>
      submitServiceAction(runtime, {
        action: "start",
        target: body,
        requestId: headers[TASK_REQUEST_ID_HEADER],
      }),

    stopSystemService: async ({ headers, query }) =>
      submitServiceAction(runtime, {
        action: "stop",
        target: query,
        requestId: headers[TASK_REQUEST_ID_HEADER],
      }),

    restartSystemService: async ({ headers, body }) =>
      submitServiceAction(runtime, {
        action: "restart",
        target: body,
        requestId: headers[TASK_REQUEST_ID_HEADER],
      }),

    loadSystemService: async ({ headers, body }) =>
      submitServiceAction(runtime, {
        action: "load",
        target: body,
        requestId: headers[TASK_REQUEST_ID_HEADER],
      }),

    uninstallSystemService: async ({ headers, query }) =>
      submitServiceAction(runtime, {
        action: "unload",
        target: query,
        requestId: headers[TASK_REQUEST_ID_HEADER],
      }),

    setSystemServiceEnabled: async ({ headers, body }) =>
      submitServiceAction(runtime, {
        action: body.disabled ? "disable" : "enable",
        target: { label: body.label, domain: body.domain },
        requestId: headers[TASK_REQUEST_ID_HEADER],
      }),

    revealSystemService: async ({ headers, body }) =>
      submitServiceAction(runtime, {
        action: "reveal",
        target: body,
        requestId: headers[TASK_REQUEST_ID_HEADER],
      }),
  })
