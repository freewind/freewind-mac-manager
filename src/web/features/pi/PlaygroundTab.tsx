import { fetchPiLabRuns } from "@shared/client-api"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@web/components/ui/button"
import { MessageSquare } from "lucide-react"

/** 抽屉目标：provider 与 model 都为空表示新开一次对话，带 runId 表示回看历史。 */
export type PlaygroundTarget = {
  provider: string
  model: string
  runId?: string
}

/**
 * Playground 分区只列历史对话，表单在右侧抽屉里复用同一套 LabTab。
 * 这样分区页与模型页点开的表单是同一个组件、同一份状态。
 */
export const PlaygroundTab = ({
  onOpen,
}: {
  onOpen: (target: PlaygroundTarget) => void
}) => {
  const history = useQuery({
    queryKey: ["pi", "lab"],
    queryFn: fetchPiLabRuns,
    retry: false,
  })
  const runs = (history.data ?? []).filter((item) => item.mode === "chat")
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-medium">Playground</h2>
        <p className="truncate text-xs text-muted-foreground">
          发送会产生真实 API 请求及费用；内容仅保留 24 小时
        </p>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => onOpen({ provider: "", model: "" })}
        >
          <MessageSquare />
          打开 Playground
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <h3 className="mb-2 text-sm font-medium">历史对话</h3>
        {history.isLoading ? <p role="status">正在读取历史…</p> : null}
        {!history.isLoading && runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有对话记录。</p>
        ) : null}
        <div className="grid gap-2">
          {runs.map((item) => (
            <Button
              key={item.id}
              variant="outline"
              className="h-auto justify-start py-2"
              onClick={() =>
                onOpen({
                  provider: item.providerId,
                  model: item.modelId,
                  runId: item.id,
                })
              }
            >
              <div className="grid min-w-0 gap-0.5 text-left">
                <span className="truncate">
                  {item.modelId} · {item.providerId}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {item.status} · {new Date(item.updatedAt).toLocaleString()}
                </span>
              </div>
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
