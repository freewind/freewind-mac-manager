import {
  fetchListeningPorts,
  fetchMachineOverview,
  fetchTopProcesses,
} from "@shared/client-api"
import { useQuery } from "@tanstack/react-query"
import { useDashboardLocalStore } from "@web/features/dashboard/store"

/** 进程表只展示占用最高的这几个。 */
export const PROCESS_LIMIT = 6

/** 远程状态统一走 TanStack Query；本地共享状态在 Zustand，页面不自己开定时器。 */
export const dashboardKeys = {
  all: ["dashboard"] as const,
  overview: ["dashboard", "overview"] as const,
  processes: ["dashboard", "processes", PROCESS_LIMIT] as const,
  ports: ["dashboard", "ports"] as const,
}

/** 响应还没拿到时的兜底刷新秒数；正常轮询一律以响应里的 refreshIntervalSeconds 为准。 */
export const FALLBACK_OVERVIEW_REFRESH_SECONDS = 3

/**
 * 概览的轮询间隔（毫秒）：服务端改成多少秒，页面就跟随多少，不在前端写死。
 */
export const overviewPollMs = (
  refreshIntervalSeconds: number | undefined
): number =>
  (refreshIntervalSeconds ?? FALLBACK_OVERVIEW_REFRESH_SECONDS) * 1000

export const useMachineOverview = () => {
  const paused = useDashboardLocalStore((state) => state.paused)
  return useQuery({
    queryKey: dashboardKeys.overview,
    queryFn: fetchMachineOverview,
    // 间隔不写死：跟随响应里的刷新秒数；还没拿到数据时先按兜底间隔取一次。
    refetchInterval: paused
      ? false
      : (query) => overviewPollMs(query.state.data?.refreshIntervalSeconds),
  })
}

export const useTopProcesses = () => {
  const paused = useDashboardLocalStore((state) => state.paused)
  return useQuery({
    queryKey: dashboardKeys.processes,
    queryFn: () => fetchTopProcesses(PROCESS_LIMIT),
    refetchInterval: paused ? false : 3000,
  })
}

export const useListeningPorts = () => {
  const paused = useDashboardLocalStore((state) => state.paused)
  return useQuery({
    queryKey: dashboardKeys.ports,
    queryFn: fetchListeningPorts,
    refetchInterval: paused ? false : 5000,
  })
}
