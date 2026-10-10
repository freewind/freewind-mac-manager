import type { TaskAccepted } from "@shared/api-contract"
import type { TaskSubmitResult } from "./runner"

/**
 * 任务提交结果到 HTTP 的映射，各域写端点共用：
 * - completed → 200/201 与真实完成结果（由端点决定是哪一个）
 * - accepted  → 202 与受理回执（未完成，必须能查询）
 * - conflict  → 409 未开始执行：同目标已有任务，或请求标识与载荷不匹配
 * - failed    → 500 真的执行了但失败
 * - unknown   → 409 结果无法确认：既不能说成功，也不能直接重做
 */
export type TaskHttpResponse<TBody, TStatus extends 200 | 201> =
  | { status: TStatus; body: TBody }
  | { status: 202; body: TaskAccepted }
  | { status: 409; body: { message: string } }
  | { status: 500; body: { message: string } }

export const toTaskHttpResponse = <TBody, TStatus extends 200 | 201>(
  outcome: TaskSubmitResult<TBody>,
  completedStatus: TStatus
): TaskHttpResponse<TBody, TStatus> => {
  switch (outcome.kind) {
    case "completed":
      return completedStatus === 201
        ? { status: 201 as TStatus, body: outcome.body }
        : { status: 200 as TStatus, body: outcome.body }
    case "accepted":
      return { status: 202, body: outcome.body }
    case "conflict":
      return { status: 409, body: { message: outcome.message } }
    case "unknown":
      return { status: 409, body: { message: outcome.message } }
    case "failed":
      return { status: 500, body: { message: outcome.message } }
  }
}
