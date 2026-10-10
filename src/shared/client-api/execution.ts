import { type TaskAccepted, TaskAcceptedSchema } from "@shared/api-contract"
import { ApiRequestError, unwrap } from "./client"

/**
 * 一次写操作的结果只有两种：
 * - completed：动作已经完成，body 是该端点自己的完成结果（200/201）。
 * - accepted：请求已接收但尚未完成，body 是受理回执，必须按任务继续查询。
 *
 * 两者不能互相冒充：受理分支没有业务结果字段，因此前端不可能把 202 当成执行成功。
 */
export type ExecutionCompleted<T> = {
  kind: "completed"
  status: number
  body: T
}

export type ExecutionAccepted = {
  kind: "accepted"
  body: TaskAccepted
}

export type Execution<T> = ExecutionCompleted<T> | ExecutionAccepted

type RespondLike = { status: number; body: unknown }

/**
 * 统一解包：202 单独按受理契约校验，其余状态继续走唯一的 unwrap。
 * 不复制 unwrap，也不新增第二套错误类型。
 */
export const runExecution = async <T>(
  call: () => Promise<RespondLike>
): Promise<Execution<T>> => {
  const result = await call()
  if (result.status === 202) {
    const parsed = TaskAcceptedSchema.safeParse(result.body)
    if (!parsed.success) {
      throw new ApiRequestError(
        "服务端返回的受理回执无法解析，请稍后在任务里确认结果",
        202,
        result.body
      )
    }
    return { kind: "accepted", body: parsed.data }
  }
  return { kind: "completed", status: result.status, body: unwrap<T>(result) }
}
