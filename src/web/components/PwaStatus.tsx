import { RefreshIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { activeWriteCount, subscribeWrites } from "@shared/client-api"
import { useIsMutating } from "@tanstack/react-query"
import { Button } from "@web/components/ui/button"
import { usePendingRequests } from "@web/features/tasks/pending-requests"
import { useActiveTasks } from "@web/features/tasks/queries"
import { usePwaStatus } from "@web/hooks/use-pwa-status"
import { useSyncExternalStore } from "react"

export const PwaStatus = () => {
  const pending = usePendingRequests()
  const { online } = usePwaStatus()
  const mutations = useIsMutating()
  const writes = useSyncExternalStore(
    subscribeWrites,
    activeWriteCount,
    () => 0
  )
  const tasks = useActiveTasks(online)
  const blocked =
    pending.length > 0 ||
    mutations > 0 ||
    writes > 0 ||
    tasks.isLoading ||
    tasks.isError ||
    (tasks.data?.tasks.length ?? 0) > 0
  const { updateAvailable, applyUpdate } = usePwaStatus(blocked)
  return (
    <>
      {!online ? (
        <div
          role="status"
          className="fixed right-3 bottom-3 z-50 rounded-md border bg-background px-3 py-2 text-xs shadow-md"
        >
          当前离线，写操作不可用，缓存数据可能已过期
        </div>
      ) : null}
      {updateAvailable ? (
        <div className="fixed right-3 bottom-16 z-50 flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs shadow-md">
          <span>
            {blocked ? "新版本已就绪，等待操作结束或核实结果" : "新版本已就绪"}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={blocked || !online}
            onClick={applyUpdate}
          >
            <HugeiconsIcon icon={RefreshIcon} />
            更新
          </Button>
        </div>
      ) : null}
    </>
  )
}
