import type {
  ActionResponse,
  ServiceDomain,
  ServicesResponse,
} from "@shared/api-contract"
import { apiClient, unwrap } from "./client"

type ServiceTarget = { label: string; domain: ServiceDomain }

export const fetchSystemServices = async (): Promise<ServicesResponse> =>
  unwrap<ServicesResponse>(await apiClient.listSystemServices())

export const startSystemService = async (
  target: ServiceTarget
): Promise<ActionResponse> =>
  unwrap<ActionResponse>(await apiClient.startSystemService({ body: target }))

export const stopSystemService = async (
  target: ServiceTarget
): Promise<ActionResponse> =>
  unwrap<ActionResponse>(await apiClient.stopSystemService({ query: target }))

export const restartSystemService = async (
  target: ServiceTarget
): Promise<ActionResponse> =>
  unwrap<ActionResponse>(await apiClient.restartSystemService({ body: target }))

export const loadSystemService = async (
  target: ServiceTarget
): Promise<ActionResponse> =>
  unwrap<ActionResponse>(await apiClient.loadSystemService({ body: target }))

export const uninstallSystemService = async (
  target: ServiceTarget
): Promise<ActionResponse> =>
  unwrap<ActionResponse>(
    await apiClient.uninstallSystemService({ query: target })
  )

export const setSystemServiceEnabled = async (
  target: ServiceTarget & { disabled: boolean }
): Promise<ActionResponse> =>
  unwrap<ActionResponse>(
    await apiClient.setSystemServiceEnabled({ body: target })
  )

export const revealSystemService = async (
  target: ServiceTarget
): Promise<ActionResponse> =>
  unwrap<ActionResponse>(await apiClient.revealSystemService({ body: target }))
