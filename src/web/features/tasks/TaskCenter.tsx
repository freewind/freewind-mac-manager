import { ClockIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { describeError } from "@shared/format"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@web/components/ui/empty"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@web/components/ui/sheet"
import { Skeleton } from "@web/components/ui/skeleton"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { usePwaStatus } from "@web/hooks/use-pwa-status"
import { useState } from "react"
import { useActiveTasks, useRecentTasks } from "./queries"
import { TaskCard } from "./TaskCard"
import { useTaskRecovery } from "./useTaskRecovery"

/**
 * 任务中心的全局入口：顶栏一个按钮 + 进行中数量，点开用官方 Sheet 列出任务。
 *
 * 关闭面板只是隐藏界面，不代表取消任务；任务由后端执行。离线时停止轮询并说明
 * 原因，不用过期数据冒充当前状态。
 */
export const TaskCenter = () => {
  const { online } = usePwaStatus()
  const [open, setOpen] = useState(false)
  const active = useActiveTasks(online)
  const query = useRecentTasks(online && open)
  const tasks = query.data?.tasks ?? active.data?.tasks ?? []
  const count = active.data?.tasks.length ?? 0
  useHistoryOverlay(open, () => setOpen(false))
  // 恢复前台或重开应用后核实未确认结果的操作；只读，不重发动作。
  const recovery = useTaskRecovery(online)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={`任务，进行中 ${count} 个`}
          >
            <HugeiconsIcon icon={ClockIcon} />
            任务
            {count > 0 ? <Badge variant="secondary">{count}</Badge> : null}
          </Button>
        }
      />
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>任务</SheetTitle>
          <SheetDescription>
            耗时操作在后台执行，这里显示真实的处理进度。
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-4">
          {!online ? (
            <p className="text-muted-foreground">
              当前离线，任务进度暂停查询。恢复网络后会自动继续。
            </p>
          ) : null}
          {recovery.unresolved > 0 ? (
            <div className="rounded-md border border-destructive/40 p-2 text-destructive">
              {recovery.unresolved}{" "}
              次操作的结果无法确认，请重新读取目标后再决定是否重试。
              <button
                type="button"
                className="ml-1 underline"
                disabled={!online || recovery.verifying}
                onClick={() => void recovery.verify()}
              >
                重新核实
              </button>
            </div>
          ) : null}
          {query.isLoading ? (
            <>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </>
          ) : null}
          {query.isError ? (
            <p className="text-destructive">
              读取任务失败：{describeError(query.error)}
            </p>
          ) : null}
          {!query.isLoading && !query.isError && tasks.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>没有近期任务</EmptyTitle>
                <EmptyDescription>
                  长耗时操作会自动出现在这里。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
