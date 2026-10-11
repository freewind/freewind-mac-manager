import type { ClashVergeStatus } from "@shared/api-contract"
import { formatBytes } from "@shared/format"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"

type StatusCardsProps = {
  status: ClashVergeStatus | undefined
}

export const StatusCards = ({ status }: StatusCardsProps) => {
  const cards = [
    { title: "内核版本", value: status?.core.version ?? "—" },
    { title: "运行模式", value: status?.config.mode ?? "—" },
    {
      title: "TUN 配置",
      value:
        status?.config.tunEnabled === null ||
        status?.config.tunEnabled === undefined
          ? "—"
          : status.config.tunEnabled
            ? "已启用"
            : "未启用",
    },
    {
      title: "下载速率",
      value:
        status?.traffic.downloadRate === null || status === undefined
          ? "—"
          : `${formatBytes(status.traffic.downloadRate)}/s`,
    },
    {
      title: "上传速率",
      value:
        status?.traffic.uploadRate === null || status === undefined
          ? "—"
          : `${formatBytes(status.traffic.uploadRate)}/s`,
    },
    {
      title: "累计流量",
      value:
        status?.traffic.downloadTotal === null || status === undefined
          ? "—"
          : `下载 ${formatBytes(status.traffic.downloadTotal)} · 上传 ${formatBytes(status.traffic.uploadTotal ?? 0)}`,
    },
  ]

  return (
    <section
      aria-label="Clash Verge 状态"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
    >
      {cards.map((card) => (
        <Card key={card.title} className="min-w-0 gap-1 py-3">
          <CardHeader className="px-4">
            <CardDescription>{card.title}</CardDescription>
            <CardTitle className="break-words text-base tabular-nums">
              {card.value}
            </CardTitle>
          </CardHeader>
          {card.title === "内核版本" ? (
            <CardContent className="px-4 text-xs text-muted-foreground">
              Mihomo 核心；不代表图形客户端或系统代理状态
            </CardContent>
          ) : null}
        </Card>
      ))}
    </section>
  )
}
