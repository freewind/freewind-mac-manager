import { initServer } from "@ts-rest/express"
import { diskGrowthRoutes } from "@shared/api-contract/routes/disk-growth"
import { healthRoutes } from "@shared/api-contract/routes/health"
import { trashEntry } from "./entry.delete"
import { getHealth } from "./health.get"
import { listEntries } from "./list-entries.get"
import { listScans } from "./list-scans.get"
import { revealEntry } from "./reveal.post"
import { startScanHandler } from "./scan.post"
import { scanStatus } from "./scan-status.get"
import { deleteScans } from "./scans.delete"
import { subtree } from "./subtree.get"

const s = initServer()

/**
 * 只挑本功能的路由注册。共享 contract 里还有别的端（流量、进程等）的路由，
 * 它们由各自的 handler 提供，等就绪后在 app.ts 合并。
 */
export const diskGrowthContract = {
  ...healthRoutes,
  ...diskGrowthRoutes,
}

export const serverRouter = s.router(diskGrowthContract, {
  getHealth,
  listScans,
  listEntries,
  subtree,
  scanStatus,
  startScan: startScanHandler,
  revealEntry,
  deleteScans,
  trashEntry,
})
