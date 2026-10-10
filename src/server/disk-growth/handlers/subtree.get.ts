import { diskGrowthStore } from "../service"

export const subtree = async ({
  query,
}: {
  query: {
    scanId: number
    baselineScanId?: number
    path: string
    depth: number
  }
}) => {
  const store = diskGrowthStore()
  const baselineScanId =
    query.baselineScanId ?? store.previousScanId(query.scanId)
  const target = query.path === "" ? "/" : query.path
  return {
    status: 200 as const,
    body: {
      root: store.subtree({
        scanId: query.scanId,
        baselineScanId,
        path: target,
        depth: query.depth,
      }),
    },
  }
}
