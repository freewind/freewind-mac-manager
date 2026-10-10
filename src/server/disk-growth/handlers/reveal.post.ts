import { toTaskHttpResponse } from "@server/common/tasks/response"
import type { TaskRuntime } from "@server/tasks/runtime"
import {
  type ActionResponse,
  type contract,
  TASK_REQUEST_ID_HEADER,
} from "@shared/api-contract"
import { ActionResponseSchema } from "@shared/api-contract/schemas/common"
import { describeError } from "@shared/format"
import type { ServerInferRequest } from "@ts-rest/core"
import { entryTaskTarget, REVEAL_KIND } from "../task"

/** 在访达中显示：命令有时限，按统一任务提交，完成结果必须过契约校验。 */
export const createRevealEntryHandler =
  (runtime: TaskRuntime) =>
  async ({
    headers,
    body,
  }: {
    headers: ServerInferRequest<typeof contract.revealEntry>["headers"]
    body: { path: string }
  }) => {
    try {
      const outcome = await runtime.runner.submit<ActionResponse>({
        kind: REVEAL_KIND,
        target: entryTaskTarget([body.path]),
        payload: { path: body.path },
        requestId: headers[TASK_REQUEST_ID_HEADER],
        toCompletedResponse: (result) => {
          const parsed = ActionResponseSchema.safeParse(result.result)
          if (!parsed.success) throw new Error("结果不符合契约")
          return { status: 200, body: parsed.data }
        },
      })
      return toTaskHttpResponse(outcome, 200)
    } catch (error) {
      return { status: 400 as const, body: { message: describeError(error) } }
    }
  }
