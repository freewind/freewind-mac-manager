import { diskGrowthStore } from "../service"

export const listScans = async () => ({
  status: 200 as const,
  body: { snapshots: diskGrowthStore.listSnapshots() },
})
