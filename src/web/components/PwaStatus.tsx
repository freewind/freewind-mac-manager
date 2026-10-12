import { activeWriteCount, subscribeWrites } from "@shared/client-api"
import { useIsMutating } from "@tanstack/react-query"
import { Button } from "@web/components/ui/button"
import { usePendingRequests } from "@web/features/tasks/pending-requests"
import { useActiveTasks } from "@web/features/tasks/queries"
import { useHasProtectedEdits } from "@web/hooks/use-edit-protection"
import { usePwaStatus } from "@web/hooks/use-pwa-status"
import { RefreshCw } from "lucide-react"
import { useSyncExternalStore } from "react"

export const PwaStatus = () => {
  const pending = usePendingRequests()
  const editing = useHasProtectedEdits()
  const { online, registrationFailed } = usePwaStatus()
  const mutations = useIsMutating()
  const writes = useSyncExternalStore(
    subscribeWrites,
    activeWriteCount,
    () => 0
  )
  const tasks = useActiveTasks(online)
  const blocked =
    editing ||
    pending.length > 0 ||
    mutations > 0 ||
    writes > 0 ||
    tasks.isLoading ||
    tasks.isError ||
    (tasks.data?.tasks.length ?? 0) > 0
  const { updateAvailable, applyUpdate } = usePwaStatus(blocked)
  return (
    <>
      {registrationFailed ? (
        <div
          role="alert"
          className="fixed right-3 bottom-28 z-50 rounded-md border bg-background p-3 text-destructive"
        >
          离线应用壳注册失败，当前无法保证离线使用
        </div>
      ) : null}
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
            <RefreshCw />
            更新
          </Button>
        </div>
      ) : null}
    </>
  )
}
