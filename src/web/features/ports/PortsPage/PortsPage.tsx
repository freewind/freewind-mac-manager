import {
  EthernetPortIcon,
  RefreshIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { formatTimestamp } from "@shared/format"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@web/components/ui/alert-dialog"
import { Button } from "@web/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import { Checkbox } from "@web/components/ui/checkbox"
import { Input } from "@web/components/ui/input"
import { REFRESH_INTERVAL_SECONDS } from "@web/features/ports/store"
import { usePorts } from "@web/features/ports/usePorts"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { useState } from "react"
import { toast } from "sonner"
import { PortFilterBar } from "./PortFilterBar"
import { PortQuickViews } from "./PortQuickViews"
import { PortTable } from "./PortTable"

type PendingConfirm = {
  title: string
  description: string
  confirmText: string
  onConfirm: () => void
}

export const PortsPage = () => {
  const model = usePorts()
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(
    null
  )

  useHistoryOverlay(pendingConfirm !== null, () => setPendingConfirm(null))

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      model.notify("已复制到剪贴板")
    } catch {
      toast.error("复制失败：浏览器拒绝了剪贴板访问")
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <HugeiconsIcon icon={EthernetPortIcon} className="size-4" />
          <h1 className="text-sm font-medium">端口管理</h1>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative">
              <HugeiconsIcon
                icon={Search01Icon}
                className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={model.search}
                onChange={(event) => model.setSearch(event.target.value)}
                placeholder="搜索端口 / 进程 / 命令 / 项目"
                className="h-7 w-full pl-7 md:w-64"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox
                aria-label="自动刷新"
                checked={model.autoRefresh}
                onCheckedChange={(checked) => model.setAutoRefresh(checked)}
              />
              自动刷新（{REFRESH_INTERVAL_SECONDS}s）
            </div>
            <Button size="sm" variant="outline" onClick={model.refresh}>
              <HugeiconsIcon icon={RefreshIcon} />
              刷新
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="监听端口"
            value={String(model.totals.listening)}
            description={`共 ${model.totals.bindings} 个套接字绑定`}
          />
          <StatCard
            title="已建立连接"
            value={String(model.totals.connected)}
            description="按对端服务端口聚合"
          />
          <StatCard
            title="对外暴露"
            value={String(model.totals.exposed)}
            description="监听在所有网卡，局域网可访问"
          />
          <StatCard
            title="涉及进程"
            value={String(model.totals.processCount)}
            description="当前筛选结果内的进程数"
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <PortQuickViews model={model} />
        <div className="flex min-h-0 flex-1 flex-col">
          <PortFilterBar model={model} />
          <PortTable
            model={model}
            onCopy={copyText}
            onRequestKill={(port, pids, names) =>
              setPendingConfirm({
                title: `结束端口 ${port} 上的 ${pids.length} 个进程？`,
                description: `进程：${names.join(", ")}；PID：${pids.join(", ")}。进程被结束后不可恢复。`,
                confirmText: "结束进程",
                onConfirm: () => model.terminate(port, pids),
              })
            }
          />
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
        <span>
          当前显示 {model.groups.length} 个端口 / {model.totals.bindings}{" "}
          个套接字
        </span>
        <span className="ml-auto">
          {model.autoRefresh
            ? `自动刷新（每 ${REFRESH_INTERVAL_SECONDS} 秒）`
            : "自动刷新已关闭"}
          {" · 上次更新 "}
          {model.updatedAt
            ? formatTimestamp(Math.floor(model.updatedAt / 1000))
            : "—"}
        </span>
      </footer>

      <AlertDialog
        open={pendingConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setPendingConfirm(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingConfirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingConfirm?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                pendingConfirm?.onConfirm()
                setPendingConfirm(null)
              }}
            >
              {pendingConfirm?.confirmText ?? "确认"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

type StatCardProps = {
  title: string
  value: string
  description: string
}

const StatCard = (props: StatCardProps) => (
  <Card className="gap-1 py-3">
    <CardHeader className="px-4">
      <CardDescription>{props.title}</CardDescription>
      <CardTitle className="text-lg tabular-nums">{props.value}</CardTitle>
    </CardHeader>
    <CardContent className="px-4">
      <p className="text-xs text-muted-foreground">{props.description}</p>
    </CardContent>
  </Card>
)
