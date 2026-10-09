import type {
  MachineOverview,
  PortsResponse,
  ProcessesResponse,
} from "@shared/api-contract"
import { apiClient, unwrap } from "./client"

export const fetchMachineOverview = async (): Promise<MachineOverview> =>
  unwrap<MachineOverview>(await apiClient.dashboardOverview())

export const fetchTopProcesses = async (
  limit: number
): Promise<ProcessesResponse> =>
  unwrap<ProcessesResponse>(
    await apiClient.listTopProcesses({ query: { limit } })
  )

export const fetchListeningPorts = async (): Promise<PortsResponse> =>
  unwrap<PortsResponse>(await apiClient.listListeningPorts())
