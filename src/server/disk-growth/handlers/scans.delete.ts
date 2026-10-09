import { diskGrowthStore } from "../service"

export const deleteScans = async ({ query }: { query: { scanIds: string } }) => {
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
      body: {
        message: `已删除 ${removed} 份快照，相邻快照的差值已自动跨过被删区间`,
      },
    }
  } catch (error) {
    return {
      status: 400 as const,
      body: { message: error instanceof Error ? error.message : String(error) },
    }
  }
}
