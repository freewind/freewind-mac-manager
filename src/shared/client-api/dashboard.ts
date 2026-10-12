import type {
  DashboardOverview,
  PortsResponse,
  ProcessesResponse,
} from "@shared/api-contract"
import { apiClient, unwrap } from "./client"

export const fetchMachineOverview = async (): Promise<DashboardOverview> =>
  unwrap<DashboardOverview>(await apiClient.dashboardOverview())

export const fetchTopProcesses = async (
  limit: number
): Promise<ProcessesResponse> =>
  unwrap<ProcessesResponse>(
    await apiClient.listTopProcesses({ query: { limit } })
  )

export const fetchListeningPorts = async (): Promise<PortsResponse> =>
  unwrap<PortsResponse>(await apiClient.listListeningPorts())
