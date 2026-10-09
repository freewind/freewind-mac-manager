import { startScan } from "../service"

export const startScanHandler = async () => ({
  status: 202 as const,
  body: startScan(),
})
