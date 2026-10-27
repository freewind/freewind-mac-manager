import { deletePiBenchmarks } from "@shared/client-api"
import { formatToSeconds } from "@shared/format"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@web/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import { toast } from "sonner"
import { piKeys, usePiBenchmarks } from "./queries"

/**
 * 测速历史分区：全部测速记录按开始时间倒序，最多 100 条，可逐条删除。
 * 与模型分区的行内测速状态共用同一个 query，切回来不会重复拉取。
 */
export const BenchmarkHistoryTab = () => {
  const queryClient = useQueryClient()
  const history = usePiBenchmarks(true)
  const removeHistory = useMutation({
    mutationFn: deletePiBenchmarks,
    onSuccess: async (response) => {
      if (response.status !== 204) toast.error("历史删除未完成")
      await queryClient.invalidateQueries({ queryKey: piKeys.benchmarks() })
    },
  })

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle>测速历史（最多 100 条）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {history.isLoading ? <p role="status">正在读取测速历史…</p> : null}
          {history.isError ? (
            <p role="alert">测速历史读取失败：{history.error.message}</p>
          ) : null}
          {history.data?.benchmarks.length === 0 ? <p>暂无测速记录。</p> : null}
          {history.data?.benchmarks.map((item) => (
            <div key={item.id} className="rounded border p-3 text-sm">
              <p>
                {item.providerId}/{item.modelId} · {item.status} · 配置上限{" "}
                {item.configuredMaxTokens} tokens
              </p>
              <p>
                首事件 {formatToSeconds(item.metrics.firstEventMs)} · 首正文{" "}
                {formatToSeconds(item.metrics.firstTextMs)} · 总时长{" "}
                {formatToSeconds(item.metrics.durationMs)}
              </p>
              <p>
                输入 {item.metrics.inputTokens ?? "—"} · 输出{" "}
                {item.metrics.outputTokens ?? "—"} · 文本输出{" "}
                {item.metrics.textOutputTokens ?? "—"} · 缓存读{" "}
                {item.metrics.cacheReadTokens ?? "—"} · 缓存写{" "}
                {item.metrics.cacheWriteTokens ?? "—"}
              </p>
              <p>
                正文 tokens/s：
                {item.metrics.outputTokensPerSecond ?? "—"} · 停止原因：
                {item.stopReason ?? "—"} · {item.error ?? "无错误"}
              </p>
              <p>
                {new Date(item.startedAt).toLocaleString()} · {item.message}
              </p>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => removeHistory.mutate([item.id])}
                disabled={removeHistory.isPending}
              >
                删除记录
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
