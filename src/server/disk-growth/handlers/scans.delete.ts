import { toTaskHttpResponse } from "@server/common/tasks/response"
import type { TaskRuntime } from "@server/tasks/runtime"
import type { contract } from "@shared/api-contract"
import { TASK_REQUEST_ID_HEADER } from "@shared/api-contract"
import { DiskSnapshotDeleteResultSchema } from "@shared/api-contract/schemas/tasks"
import { describeError } from "@shared/format"
import type { ServerInferRequest } from "@ts-rest/core"
import { DISCARD_KIND } from "../task"

/**
 * 删除快照可能涉及很多明细行，是一次同步写库的重活：同样按任务提交，
 * 请求标识由契约 headers 强制要求，完成返回真实删除份数、未完成返回任务标识。
 */
export const createDeleteScansHandler =
  (runtime: TaskRuntime) =>
  async ({
    headers,
    query,
  }: {
    headers: ServerInferRequest<typeof contract.deleteScans>["headers"]
    query: { scanIds: string }
  }) => {
    const scanIds = query.scanIds
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0)
    if (scanIds.length === 0) {
      return {
        status: 400 as const,
        body: { message: "没有指定要删除的快照" },
      }
    }
    try {
      const outcome = await runtime.runner.submit<{ removed: number }>({
        kind: DISCARD_KIND,
        target: "disk-growth:snapshots",
        payload: { scanIds },
        requestId: headers[TASK_REQUEST_ID_HEADER],
        toCompletedResponse: (result) => {
          const parsed = DiskSnapshotDeleteResultSchema.safeParse(result.result)
          if (!parsed.success) {
            throw new Error("删除快照结果不符合契约，无法作为完成结果返回")
          }
          return { status: 200, body: parsed.data }
        },
      })
      return toTaskHttpResponse(outcome, 200)
    } catch (error) {
      return { status: 500 as const, body: { message: describeError(error) } }
    }
  }
