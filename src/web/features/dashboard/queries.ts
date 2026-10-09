import { useQuery } from "@tanstack/react-query"
import {
  fetchListeningPorts,
  fetchMachineSnapshot,
  fetchTopProcesses,
  type MachineSnapshot,
  type PortInfo,
  type ProcessInfo,
} from "@web/features/dashboard/mock-data"
import { useDashboardStore } from "@web/features/dashboard/store"

/** 远程状态统一走 TanStack Query；本地共享状态在 Zustand，页面不自己开定时器。 */
export const dashboardKeys = {
  all: ["dashboard"] as const,
  snapshot: ["dashboard", "snapshot"] as const,
  processes: ["dashboard", "processes"] as const,
  ports: ["dashboard", "ports"] as const,
}

export const useMachineSnapshot = () => {
  const paused = useDashboardStore((state) => state.paused)
  return useQuery<MachineSnapshot>({
    queryKey: dashboardKeys.snapshot,
    queryFn: fetchMachineSnapshot,
    refetchInterval: paused ? false : 3000,
  })
}

export const useTopProcesses = () => {
  const paused = useDashboardStore((state) => state.paused)
  return useQuery<ProcessInfo[]>({
    queryKey: dashboardKeys.processes,
    queryFn: fetchTopProcesses,
    refetchInterval: paused ? false : 3000,
  })
}

export const useListeningPorts = () => {
  const paused = useDashboardStore((state) => state.paused)
  return useQuery<PortInfo[]>({
    queryKey: dashboardKeys.ports,
    queryFn: fetchListeningPorts,
    refetchInterval: paused ? false : 5000,
  })
}
