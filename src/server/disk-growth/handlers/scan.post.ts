import { toTaskHttpResponse } from "@server/common/tasks/response"
import type { TaskRuntime } from "@server/tasks/runtime"
import type { contract } from "@shared/api-contract"
import { TASK_REQUEST_ID_HEADER } from "@shared/api-contract"
import { describeError } from "@shared/format"
import type { ServerInferRequest } from "@ts-rest/core"
import { submitScanTask } from "../service"

/**
 * 手动扫描。
 *
 * 请求标识由契约的 headers 校验强制要求，因此同一次请求重发只会复用同一个任务；
 * 阈值内完成返回 201 与快照信息，未完成返回 202 与任务标识。
 */
export const createStartScanHandler =
  (runtime: TaskRuntime) =>
  async ({
    headers,
  }: {
    headers: ServerInferRequest<typeof contract.startScan>["headers"]
  }) => {
    try {
      const outcome = await submitScanTask(
        runtime.runner,
        headers[TASK_REQUEST_ID_HEADER]
      )
      return toTaskHttpResponse(outcome, 201)
    } catch (error) {
      // 完成结果不符合契约等未预期错误必须回 JSON，不能漏成 HTML 错误页。
      return { status: 500 as const, body: { message: describeError(error) } }
    }
  }
