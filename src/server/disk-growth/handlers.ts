import { initServer } from "@ts-rest/express"
import { contract } from "@shared/api-contract"
import { moveToTrash, revealInFinder } from "@server/common/file-actions"
import { diskGrowthStore, getScanStatus, startScan } from "./service"

const s = initServer()

/**
 * 只挑本功能的路由注册。共享 contract 里还有其他端（如流量监控）的路由，
 * 它们由各自的 handler 提供，等就绪后在 app.ts 合并。
 */
export const diskGrowthContract = {
  getHealth: contract.getHealth,
  listScans: contract.listScans,
  listEntries: contract.listEntries,
  subtree: contract.subtree,
  deleteScans: contract.deleteScans,
  scanStatus: contract.scanStatus,
  startScan: contract.startScan,
  revealEntry: contract.revealEntry,
  trashEntry: contract.trashEntry,
}

export const serverRouter = s.router(diskGrowthContract, {
  getHealth: async () => ({ status: 200, body: { ok: true } }),

  listScans: async () => ({
    status: 200,
    body: { snapshots: diskGrowthStore.listSnapshots() },
  }),

  listEntries: async ({ query }) => {
    const baselineScanId =
      query.baselineScanId ?? diskGrowthStore.previousScanId(query.scanId)
    const keyword = query.keyword?.trim()
    const current = keyword
      ? null
      : diskGrowthStore.getEntry({
          scanId: query.scanId,
          previousScanId: baselineScanId,
          path: query.path,
        })
    const entries = diskGrowthStore.listEntries({
      scanId: query.scanId,
      baselineScanId,
      parent: query.path,
      keyword,
    })
    return { status: 200, body: { current, entries } }
  },

  subtree: async ({ query }) => {
    const baselineScanId =
      query.baselineScanId ?? diskGrowthStore.previousScanId(query.scanId)
    const target = query.path === "" ? "/" : query.path
    return {
      status: 200,
      body: {
        root: diskGrowthStore.subtree({
          scanId: query.scanId,
          baselineScanId,
          path: target,
          depth: query.depth,
        }),
      },
    }
  },

  deleteScans: async ({ query }) => {
    try {
      const ids = query.scanIds
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0)
      if (ids.length === 0) {
        return { status: 400 as const, body: { message: "没有指定要删除的快照" } }
      }
      const removed = diskGrowthStore.deleteSnapshots(ids)
      return {
        status: 202 as const,
        body: { message: `已删除 ${removed} 份快照，相邻快照的差值已自动跨过被删区间` },
      }
    } catch (error) {
      return {
        status: 400 as const,
        body: { message: error instanceof Error ? error.message : String(error) },
      }
    }
  },

  scanStatus: async () => ({ status: 200, body: getScanStatus() }),

  revealEntry: async ({ body }) => {
    try {
      return { status: 202 as const, body: { message: await revealInFinder(body.path) } }
    } catch (error) {
      return {
        status: 400 as const,
        body: { message: error instanceof Error ? error.message : String(error) },
      }
    }
  },

  trashEntry: async ({ query }) => {
    try {
      return { status: 202 as const, body: { message: await moveToTrash(query.path) } }
    } catch (error) {
      return {
        status: 400 as const,
        body: { message: error instanceof Error ? error.message : String(error) },
      }
    }
  },

  startScan: async () => {
    const outcome = startScan()
    return { status: 202, body: outcome }
  },
})
