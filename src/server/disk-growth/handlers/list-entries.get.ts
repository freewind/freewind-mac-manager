import { diskGrowthStore } from "../service"

export const listEntries = async ({
  query,
}: {
  query: {
    scanId: number
    baselineScanId?: number
    path: string
    keyword?: string
  }
}) => {
  const store = diskGrowthStore()
  const baselineScanId =
    query.baselineScanId ?? store.previousScanId(query.scanId)
  const keyword = query.keyword?.trim()
  const current = keyword
    ? null
    : store.getEntry({
        scanId: query.scanId,
        previousScanId: baselineScanId,
        path: query.path,
      })
  const entries = store.listEntries({
    scanId: query.scanId,
    baselineScanId,
    parent: query.path,
    keyword,
  })
  return { status: 200 as const, body: { current, entries } }
}
