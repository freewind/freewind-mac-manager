import type {
  MachineOverview,
  PortsResponse,
  ProcessesResponse,
} from "@shared/api-contract"
import { apiClient } from "./client"

const unwrap = <T>(result: { status: number; body: unknown }): T => {
  if (result.status >= 200 && result.status < 300) return result.body as T
  const body = result.body as { message?: string } | undefined
  throw new Error(body?.message ?? `请求失败（HTTP ${result.status}）`)
}

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
