import type { McpCallRecord } from "@shared/api-contract"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@web/components/ui/empty"
import { Skeleton } from "@web/components/ui/skeleton"
import { History, RefreshCw } from "lucide-react"
import { useState } from "react"
import {
  CALL_STATUS_LABELS,
  CALL_STATUS_VARIANTS,
  formatClock,
  formatDuration,
  prettyJson,
} from "./format"
import { useMcpCallsQuery } from "./queries"
import { ResultView } from "./ResultView"

const KIND_LABELS: Record<McpCallRecord["kind"], string> = {
  tool: "工具",
  resource: "资源",
  prompt: "提示词",
}

/**
 * 调用记录。
 *
 * 记录是「已经发生过的事」：超时那条会明确标成结果未知，并且不提供重试按钮，
 * 避免用户把它当成一次可以安全重放的失败。
 */
export const CallRecords = (props: { serverId: string | null }) => {
  const query = useMcpCallsQuery(props.serverId)
  const [expanded, setExpanded] = useState<string | null>(null)

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  }

  if (query.isError || !query.data) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-destructive">
          读取调用记录失败：{query.error?.message ?? "未知原因"}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="px-3"
          onClick={() => void query.refetch()}
        >
          <RefreshCw aria-hidden="true" />
          重新读取
        </Button>
      </div>
    )
  }

  const records = query.data.calls

  if (records.length === 0) {
    return (
      <Empty className="py-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <History />
          </EmptyMedia>
          <EmptyTitle>还没有调用记录</EmptyTitle>
          <EmptyDescription>
            在「工具」「资源」「提示词」里发起一次调用后，记录会出现在这里。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">调用记录</h2>
        <p className="text-xs text-muted-foreground">
          共 {records.length} 条，最近的在前
        </p>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto shrink-0 px-3"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw aria-hidden="true" />
          刷新
        </Button>
      </div>

      <ul className="flex min-w-0 flex-col gap-2">
        {records.map((record) => {
          const open = expanded === record.id
          return (
            <li key={record.id} className="min-w-0 rounded-lg border">
              <button
                type="button"
                aria-expanded={open}
                className="flex w-full min-w-0 flex-wrap items-center gap-2 rounded-lg p-3 text-left hover:bg-muted/50"
                onClick={() => setExpanded(open ? null : record.id)}
              >
                <Badge variant={CALL_STATUS_VARIANTS[record.status]}>
                  {CALL_STATUS_LABELS[record.status]}
                </Badge>
                <Badge variant="outline">{KIND_LABELS[record.kind]}</Badge>
                <span className="min-w-0 font-mono text-sm break-all">
                  {record.name}
                </span>
                {props.serverId === null ? (
                  <span className="text-xs text-muted-foreground">
                    {record.serverName}
                  </span>
                ) : null}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {formatClock(record.startedAt)} ·{" "}
                  {formatDuration(record.durationMs)}
                </span>
              </button>
              {open ? (
                <div className="flex min-w-0 flex-col gap-3 border-t p-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-xs font-medium">入参</span>
                    <pre className="max-w-full overflow-x-auto rounded-md border bg-muted/40 p-2 font-mono text-xs">
                      {prettyJson(record.request)}
                    </pre>
                  </div>
                  <ResultView record={record} />
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
