import { initServer } from "@ts-rest/express"
import { contract } from "@shared/api-contract"
import { portsHandlers } from "@server/ports/handlers"
import { diskGrowthStore, getScanStatus, startScan } from "./service"

const s = initServer()

export const serverRouter = s.router(contract, {
  getHealth: async () => ({ status: 200, body: { ok: true } }),

  listScans: async () => ({
    status: 200,
    body: { snapshots: diskGrowthStore.listSnapshots() },
  }),

  listEntries: async ({ query }) => {
    const previousScanId = diskGrowthStore.previousScanId(query.scanId)
    const keyword = query.keyword?.trim()
    const current = keyword
      ? null
      : diskGrowthStore.getEntry({
          scanId: query.scanId,
          previousScanId,
          path: query.path,
        })
    const entries = diskGrowthStore.listEntries({
      scanId: query.scanId,
      previousScanId,
      parent: query.path,
      keyword,
    })
    return { status: 200, body: { current, entries } }
  },

  scanStatus: async () => ({ status: 200, body: getScanStatus() }),

  startScan: async () => {
    const outcome = startScan()
    return { status: 202, body: outcome }
  },

  ...portsHandlers,
})
