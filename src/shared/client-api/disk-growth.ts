import type {
  EntriesResponse,
  ScanStartResponse,
  ScanStatus,
  ScansResponse,
} from "@shared/api-contract"
import { apiClient } from "./client"

const unwrap = <T>(result: { status: number; body: unknown }): T => {
  if (result.status >= 200 && result.status < 300) return result.body as T
  const body = result.body as { message?: string } | undefined
  throw new Error(body?.message ?? `请求失败（HTTP ${result.status}）`)
}

export const fetchScans = async (): Promise<ScansResponse> =>
  unwrap<ScansResponse>(await apiClient.listScans())

export const fetchEntries = async (options: {
  scanId: number
  path: string
  keyword?: string
}): Promise<EntriesResponse> =>
  unwrap<EntriesResponse>(await apiClient.listEntries({ query: options }))

export const fetchScanStatus = async (): Promise<ScanStatus> =>
  unwrap<ScanStatus>(await apiClient.scanStatus())

export const triggerScan = async (): Promise<ScanStartResponse> =>
  unwrap<ScanStartResponse>(await apiClient.startScan())
