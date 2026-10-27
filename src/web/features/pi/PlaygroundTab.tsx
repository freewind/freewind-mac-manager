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
        {runs.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Provider</th>
                  <th className="px-3 py-2 font-medium">模型</th>{" "}
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">时间</th>
                  <th className="px-3 py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((item) => (
                  <tr key={item.id} className="border-b last:border-b-0">
                    <td className="px-3 py-2 break-all">{item.providerId}</td>
                    <td className="px-3 py-2 break-all text-muted-foreground">
                      {item.modelId}
                    </td>{" "}
                    <td className="px-3 py-2 text-muted-foreground">
                      {item.status}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(item.updatedAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6"
                        onClick={() =>
                          onOpen({
                            provider: item.providerId,
                            model: item.modelId,
                            runId: item.id,
                          })
                        }
                      >
                        <MessageSquare />
                        打开
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  )
}
