import { toTaskHttpResponse } from "@server/common/tasks/response"
import type { TaskRuntime } from "@server/tasks/runtime"
import {
  type ActionResponse,
  type contract,
  TASK_REQUEST_ID_HEADER,
} from "@shared/api-contract"
import { ActionResponseSchema } from "@shared/api-contract/schemas/common"
import { describeError } from "@shared/format"
import { fileMutationLockTarget } from "@shared/task-targets"
import type { ServerInferRequest } from "@ts-rest/core"
import { entryTaskTarget, TRASH_KIND } from "../task"

/**
 * 移到废纸篓：与文件域写操作共用同一把互斥键，
 * 避免删除、移动或改名期间再次改变同一文件树。
 */
export const createTrashEntryHandler =
  (runtime: TaskRuntime) =>
  async ({
    headers,
    query,
  }: {
    headers: ServerInferRequest<typeof contract.trashEntry>["headers"]
    query: { path: string }
  }) => {
    try {
      const outcome = await runtime.runner.submit<ActionResponse>({
        kind: TRASH_KIND,
        target: entryTaskTarget([query.path]),
        lockTarget: fileMutationLockTarget(),
        payload: { path: query.path },
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
