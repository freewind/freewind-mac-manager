import type { McpServer } from "@shared/api-contract"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import { RefreshCw } from "lucide-react"
import { useMcpLogsQuery } from "./queries"

/**
 * stdio 服务器子进程的 stderr 尾部。
 *
 * 只保留最近一段（服务端有字节上限），用于排错；不轮询，展开后手动刷新。
 * 远程服务器没有子进程，因此不显示这一块。
 */
export const ServerLogs = (props: { server: McpServer }) => {
  const query = useMcpLogsQuery(props.server.config.id, true)
  const lines = query.data?.lines ?? []

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">子进程日志</h2>
        <p className="text-xs text-muted-foreground">
          服务端 stderr 的尾部，只保留最近一段
        </p>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto shrink-0 px-3"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw aria-hidden="true" />
          刷新日志
        </Button>
      </div>

      {query.isError ? (
        <Alert variant="destructive">
          <AlertTitle>读取日志失败</AlertTitle>
          <AlertDescription>
            {query.error?.message ?? "没有拿到日志内容。"}
          </AlertDescription>
        </Alert>
      ) : query.isLoading ? (
        <p className="text-sm text-muted-foreground">正在读取日志…</p>
      ) : lines.length === 0 ? (
        <p className="rounded-lg border p-3 text-sm text-muted-foreground">
          这台服务器还没有往 stderr
          写任何内容。启动失败的原因会在上面的连接状态里说明。
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-1">
          {query.data?.truncated ? (
            <span className="text-xs text-muted-foreground">
              日志较长，只保留并显示最近一段。
            </span>
          ) : null}
          <pre className="max-h-80 max-w-full overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap break-all">
            {lines.join("\n")}
          </pre>
        </div>
      )}
    </section>
  )
}
