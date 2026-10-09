import { getScanStatus } from "../service"

export const scanStatus = async () => ({
  status: 200 as const,
  body: getScanStatus(),
})
