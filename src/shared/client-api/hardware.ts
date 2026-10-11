import type { HardwareOverview } from "@shared/api-contract"
import { apiClient, unwrap } from "./client"

export const fetchHardwareOverview = async (): Promise<HardwareOverview> =>
  unwrap<HardwareOverview>(await apiClient.hardwareOverview())
