import type { TaskListResponse, TaskRecord } from "@shared/api-contract"
import { fetchActiveTasks, fetchTask } from "@shared/client-api"
import { useQuery } from "@tanstack/react-query"

export const taskKeys = {
  all: ["tasks"] as const,
  active: ["tasks", "active"] as const,
  detail: (id: string) => ["tasks", "detail", id] as const,
}

/**
 * 进行中的任务列表：唯一一处轮询。
 * 没有进行中的任务时停止轮询；离线或未登录时由调用方禁用查询。
 */
export const useActiveTasks = (enabled: boolean) =>
  useQuery({
    queryKey: taskKeys.active,
    queryFn: ({ signal }): Promise<TaskListResponse> =>
      fetchActiveTasks({ signal }),
    enabled,
    refetchInterval: (query) =>
      (query.state.data?.tasks.length ?? 0) > 0 ? 2000 : false,
  })

/**
 * 按需查看单个任务：只在真的有一个已知任务时查询，并轮询到它终结为止。
 * 查不到会抛错——那只说明无法核实，不代表动作没有执行。
 */
export const useTaskDetail = (taskId: string | null) =>
  useQuery({
    queryKey: taskKeys.detail(taskId ?? ""),
    queryFn: ({ signal }): Promise<TaskRecord> =>
      fetchTask(taskId as string, { signal }),
    enabled: taskId !== null,
    refetchInterval: (query) =>
      query.state.data && query.state.data.status === "running" ? 2000 : false,
  })
