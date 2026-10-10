import type {
  TaskListQueryInput,
  TaskListResponse,
  TaskRecord,
} from "@shared/api-contract"
import { apiClient, unwrap } from "./client"

/**
 * 任务查询是只读的：AbortSignal 只取消这次读取，不影响服务端正在执行的任务。
 */
export const fetchTasks = async (
  query: TaskListQueryInput,
  options?: { signal?: AbortSignal }
): Promise<TaskListResponse> =>
  unwrap<TaskListResponse>(
    await apiClient.listTasks({
      query,
      fetchOptions: options?.signal ? { signal: options.signal } : undefined,
    })
  )

/**
 * 按 id 读单个任务。查不到会抛错（404），不要把「没有记录」解释成
 * 「该操作没有执行」——只能说明无法核实，需要重新读取目标。
 */
export const fetchTask = async (
  id: string,
  options?: { signal?: AbortSignal }
): Promise<TaskRecord> =>
  unwrap<TaskRecord>(
    await apiClient.getTask({
      params: { id },
      fetchOptions: options?.signal ? { signal: options.signal } : undefined,
    })
  )

/** 按请求标识核实：响应丢失后用它找回当初那次操作对应的任务。 */
export const fetchTaskByRequestId = async (
  requestId: string,
  options?: { signal?: AbortSignal }
): Promise<TaskRecord | null> => {
  const response = await fetchTasks(
    { status: "all", requestId, pageSize: 1 },
    options
  )
  return response.tasks[0] ?? null
}

/** 只看仍在运行的任务，用于任务中心与冲突判断。 */
export const fetchActiveTasks = async (options?: {
  signal?: AbortSignal
}): Promise<TaskListResponse> =>
  fetchTasks({ status: "active", pageSize: 50 }, options)
