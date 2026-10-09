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
  const baselineScanId =
    query.baselineScanId ?? diskGrowthStore.previousScanId(query.scanId)
  const target = query.path === "" ? "/" : query.path
  return {
    status: 200 as const,
    body: {
      root: diskGrowthStore.subtree({
        scanId: query.scanId,
        baselineScanId,
        path: target,
        depth: query.depth,
      }),
    },
  }
}
