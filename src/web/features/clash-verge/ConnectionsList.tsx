import type { ClashVergeConnection } from "@shared/api-contract"
import { formatBytes } from "@shared/format"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@web/components/ui/collapsible"

type ConnectionsListProps = {
  connections: ClashVergeConnection[]
  total: number
  truncated: boolean
  sampledAt: number | undefined
  /** 后端响应的条数上限；未返回时回退默认值，不改写行为。 */
  limit?: number
}

/** 后端未返回 limit 时的回退：与服务端 connectionLimit 默认一致（200）。 */
const DEFAULT_CONNECTION_LIMIT = 200

/**
 * 活动连接分区：默认一行一条简短信息（目标 + 进程 + 规则），
 * 完整连接信息（来源、网络、代理链、流量、时间）按需展开，
 * 不单独加滚动，随标签主体滚动；上限文案取后端值，不再写死。
 */
export const ConnectionsList = ({
  connections,
  total,
  truncated,
  sampledAt,
  limit,
}: ConnectionsListProps) => {
  const cap = limit ?? DEFAULT_CONNECTION_LIMIT
  return (
    <section className="space-y-3" aria-label="活动连接">
      <div>
        <h2 className="text-sm font-medium">活动连接（{total}）</h2>
        <p className="text-xs text-muted-foreground">
          {sampledAt
            ? `采集于 ${new Date(sampledAt).toLocaleTimeString()}`
            : "尚无成功采集"}
          {truncated ? ` · 仅显示前 ${cap} 条` : ` · 最多读取 ${cap} 条`}
        </p>
      </div>
      {connections.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          当前没有活动连接
        </p>
      ) : (
        <div className="grid gap-2">
          {connections.map((connection) => (
            <Collapsible key={connection.id}>
              <CollapsibleTrigger
                render={
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center gap-2 rounded-lg border px-4 py-3 text-left text-sm hover:bg-muted/40"
                  >
                    <span className="min-w-0 flex-1 break-all">
                      {connection.destination ?? "未知目标"}
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                      {connection.process ?? "未知进程"}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {connection.rule ?? "未知规则"}
                    </span>
                  </button>
                }
              />
              <CollapsibleContent>
                <div className="space-y-1 border-t px-4 py-3 text-xs text-muted-foreground">
                  <p className="break-all">
                    来源：{connection.source ?? "未知"} ·{" "}
                    {connection.network ?? "未知协议"}
                  </p>
                  <p className="break-all">
                    进程：{connection.process ?? "未知"}
                  </p>
                  <p className="break-all">
                    代理链：{connection.chains.join(" → ") || "直连/未知"}
                  </p>
                  <p className="break-all">
                    规则：{connection.rule ?? "未知"}
                    {connection.rulePayload
                      ? ` · ${connection.rulePayload}`
                      : ""}
                  </p>
                  <p>
                    上传 {formatBytes(connection.upload)} · 下载{" "}
                    {formatBytes(connection.download)}
                  </p>
                  <p>开始时间：{connection.startedAt || "未知"}</p>
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      )}
    </section>
  )
}
