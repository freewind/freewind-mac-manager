import { contract } from "@shared/api-contract"
import { initServer } from "@ts-rest/express"
import { trashEntry } from "./entry.delete"
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
 * 它们由各自的 handler 提供，最终在 app.ts 一起挂载。
 * 必须取共享 contract 里的现值：它带 /api 前缀，与客户端请求同源；
 * 直接用 routes 里的裸路径会注册到 /disk-growth/*，与前端 /api/disk-growth/* 不一致。
 */
export const diskGrowthContract = {
  listScans: contract.listScans,
  listEntries: contract.listEntries,
  subtree: contract.subtree,
  scanStatus: contract.scanStatus,
  startScan: contract.startScan,
  revealEntry: contract.revealEntry,
  deleteScans: contract.deleteScans,
  trashEntry: contract.trashEntry,
}

export const diskGrowthRouter = s.router(diskGrowthContract, {
  listScans,
  listEntries,
  subtree,
  scanStatus,
  startScan: startScanHandler,
  revealEntry,
  deleteScans,
  trashEntry,
})
