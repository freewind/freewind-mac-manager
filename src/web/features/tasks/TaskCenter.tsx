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
import { usePwaStatus } from "@web/hooks/use-pwa-status"
import { useState } from "react"
import { useActiveTasks } from "./queries"
import { TaskCard } from "./TaskCard"

/**
 * 任务中心的全局入口：顶栏一个按钮 + 进行中数量，点开用官方 Sheet 列出任务。
 *
 * 关闭面板只是隐藏界面，不代表取消任务；任务由后端执行。离线时停止轮询并说明
 * 原因，不用过期数据冒充当前状态。
 */
export const TaskCenter = () => {
  const { online } = usePwaStatus()
  const [open, setOpen] = useState(false)
  const query = useActiveTasks(online)
  const tasks = query.data?.tasks ?? []
  const count = tasks.length

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
          {!query.isLoading && !query.isError && count === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>没有进行中的任务</EmptyTitle>
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
