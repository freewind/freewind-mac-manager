import type { ClashVergeConnection } from "@shared/api-contract"
import { formatBytes } from "@shared/format"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"

type ConnectionsListProps = {
  connections: ClashVergeConnection[]
  total: number
  truncated: boolean
  sampledAt: number | undefined
}

export const ConnectionsList = ({
  connections,
  total,
  truncated,
  sampledAt,
}: ConnectionsListProps) => (
  <section className="space-y-3" aria-label="活动连接">
    <div>
      <h2 className="text-sm font-medium">活动连接（{total}）</h2>
      <p className="text-xs text-muted-foreground">
        {sampledAt
          ? `采集于 ${new Date(sampledAt).toLocaleTimeString()}`
          : "尚无成功采集"}
        {truncated ? " · 仅显示前 200 条" : " · 最多读取 200 条"}
      </p>
    </div>
    {connections.length === 0 ? (
      <p className="rounded-lg border p-4 text-sm text-muted-foreground">
        当前没有活动连接
      </p>
    ) : (
      <div className="grid gap-2">
        {connections.map((connection) => (
          <Card key={connection.id} className="min-w-0 gap-2 py-3">
            <CardHeader className="px-4">
              <CardTitle className="break-all text-sm">
                {connection.destination ?? "未知目标"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 px-4 text-xs text-muted-foreground">
              <p className="break-all">
                来源：{connection.source ?? "未知"} ·{" "}
                {connection.network ?? "未知协议"}
              </p>
              <p className="break-all">进程：{connection.process ?? "未知"}</p>
              <p className="break-all">
                代理链：{connection.chains.join(" → ") || "直连/未知"}
              </p>
              <p className="break-all">
                规则：{connection.rule ?? "未知"}
                {connection.rulePayload ? ` · ${connection.rulePayload}` : ""}
              </p>
              <p>
                上传 {formatBytes(connection.upload)} · 下载{" "}
                {formatBytes(connection.download)}
              </p>
              <p>开始时间：{connection.startedAt || "未知"}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    )}
  </section>
)
