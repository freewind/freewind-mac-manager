import type {
  ActionResponse,
  TreeResponse,
  EntriesResponse,
  ScanStartResponse,
  ScanStatus,
  ScansResponse,
} from "@shared/api-contract"
import { apiClient, unwrap } from "./client"

export const fetchScans = async (): Promise<ScansResponse> =>
  unwrap<ScansResponse>(await apiClient.listScans())

export const fetchEntries = async (options: {
  scanId: number
  baselineScanId?: number
  path: string
  keyword?: string
}): Promise<EntriesResponse> =>
  unwrap<EntriesResponse>(await apiClient.listEntries({ query: options }))

export const fetchScanStatus = async (): Promise<ScanStatus> =>
  unwrap<ScanStatus>(await apiClient.scanStatus())

export const triggerScan = async (): Promise<ScanStartResponse> =>
  unwrap<ScanStartResponse>(await apiClient.startScan())

export const revealEntry = async (path: string): Promise<ActionResponse> =>
  unwrap<ActionResponse>(await apiClient.revealEntry({ body: { path } }))

export const trashEntry = async (path: string): Promise<ActionResponse> =>
  unwrap<ActionResponse>(await apiClient.trashEntry({ query: { path } }))

export const deleteScans = async (scanIds: number[]): Promise<ActionResponse> =>
  unwrap<ActionResponse>(
    await apiClient.deleteScans({ query: { scanIds: scanIds.join(",") } })
  )

export const fetchTree = async (options: {
  scanId: number
  baselineScanId?: number
  path: string
  depth: number
}): Promise<TreeResponse> =>
  unwrap<TreeResponse>(await apiClient.subtree({ query: options }))
