import type { DockerContainer } from "@shared/api-contract"
import { formatTimestamp } from "@shared/format"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@web/components/ui/sheet"
import { Skeleton } from "@web/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@web/components/ui/tooltip"
import {
  DOCKER_LOG_TAIL_DEFAULT,
  useDockerContainerLogsQuery,
} from "@web/features/docker/queries"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { RefreshCw } from "lucide-react"

type ContainerLogsSheetProps = {
  container: DockerContainer | null
  onClose: () => void
}

/**
 * 容器日志抽屉：按需读取末尾若干行，支持手动重新读取。
 * 日志会一直增长，所以这里不做轮询；历史内容标明读取时间，避免被当成实时输出。
 */
export const ContainerLogsSheet = (props: ContainerLogsSheetProps) => {
  const containerId = props.container?.id ?? ""
  const logs = useDockerContainerLogsQuery(containerId, DOCKER_LOG_TAIL_DEFAULT)

  useHistoryOverlay(props.container !== null, props.onClose)

  return (
    <Sheet
      open={props.container !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <SheetContent side="right" className="gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="gap-1 border-b p-4">
          <SheetTitle className="flex min-w-0 items-center gap-1">
            <span className="shrink-0">日志</span>
            {/* 容器名可能很长：标题里也不截断文本，完整值在悬停/聚焦时给出。 */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="min-w-0 truncate">
                    {props.container?.name ?? ""}
                  </span>
                }
              />
              <TooltipContent className="max-w-lg break-all">
                {props.container?.name ?? ""}
              </TooltipContent>
            </Tooltip>
          </SheetTitle>
          <SheetDescription>
            末尾 {DOCKER_LOG_TAIL_DEFAULT} 行；日志会持续增长，这里只按需读取。
          </SheetDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              variant="outline"
              className="min-h-11 px-3"
              onClick={() => void logs.refetch()}
              disabled={logs.isFetching}
            >
              <RefreshCw aria-hidden="true" />
              {logs.isFetching ? "正在重新读取…" : "重新读取"}
            </Button>
            <p className="text-xs text-muted-foreground">
              {logs.data
                ? `数据时间 ${formatTimestamp(logs.data.fetchedAt / 1000)} · ${logs.data.lines.length} 行`
                : "正在读取日志…"}
            </p>
          </div>
        </SheetHeader>

        {logs.isError ? (
          <div className="p-4">
            <Alert variant="destructive" role="alert">
              <AlertTitle>读取日志失败</AlertTitle>
              <AlertDescription>
                容器可能已经退出或 Docker 未运行，请重新读取核实。
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
          {logs.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-4/5" />
              <Skeleton className="h-6 w-3/5" />
            </div>
          ) : logs.data && logs.data.lines.length > 0 ? (
            <>
              {logs.data.truncated ? (
                <p className="pb-2 text-xs text-muted-foreground">
                  上游还有更早的输出，这里只显示末尾 {logs.data.lines.length}{" "}
                  行。
                </p>
              ) : null}
              {/* 窄屏在抽屉内局部滚动：长行折行而不是把页面撑宽 */}
              <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                {logs.data.lines.join("\n")}
              </pre>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              这个容器还没有输出日志。
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
