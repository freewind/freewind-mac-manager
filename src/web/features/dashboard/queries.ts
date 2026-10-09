import { useQuery } from "@tanstack/react-query"
import {
  fetchListeningPorts,
  fetchMachineOverview,
  fetchTopProcesses,
} from "@shared/client-api"
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

export const useMachineOverview = () => {
  const paused = useDashboardLocalStore((state) => state.paused)
  return useQuery({
    queryKey: dashboardKeys.overview,
    queryFn: fetchMachineOverview,
    refetchInterval: paused ? false : 3000,
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
