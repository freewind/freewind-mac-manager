import { formatTimestamp } from "@shared/format"
import { ActionButton } from "@web/components/ActionButton"
import { PageHeader } from "@web/components/PageHeader"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@web/components/ui/alert-dialog"
import { Button } from "@web/components/ui/button"
import { Checkbox } from "@web/components/ui/checkbox"
import { Input } from "@web/components/ui/input"
import { PORT_VIEWS, REFRESH_INTERVAL_SECONDS } from "@web/features/ports/store"
import { usePorts } from "@web/features/ports/usePorts"
import { useDialogSubmit } from "@web/hooks/use-dialog-submit"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import { Network, RefreshCw, Search } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { PortFilterBar } from "./PortFilterBar"
import { PortQuickViews, PortViewSelect } from "./PortQuickViews"
import { PortTable } from "./PortTable"

type PendingConfirm = {
  title: string
  description: string
  confirmText: string
  onConfirm: () => Promise<boolean>
}

export const PortsPage = () => {
  const model = usePorts()
  const isDesktop = useIsDesktop()
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(
    null
  )
  const viewLabel =
    PORT_VIEWS.find((item) => item.key === model.view)?.label ?? model.view

  const submission = useDialogSubmit(
    () => setPendingConfirm(null),
    model.killBusy
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
          <Network className="size-4" />
          <PageHeader title="端口管理" loading={model.isLoading} />

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {isDesktop ? null : <PortViewSelect model={model} />}
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
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
              <RefreshCw />
              刷新
            </Button>
          </div>
        </div>

        {/* 一行紧凑摘要：四个关键数字，详细说明不再常驻顶部。 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground">
          <StatItem label="监听端口" value={model.totals.listening} />
          <StatItem label="已建立连接" value={model.totals.connected} />
          <StatItem label="对外暴露" value={model.totals.exposed} />
          <StatItem label="涉及进程" value={model.totals.processCount} />
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
        {isDesktop ? <PortQuickViews model={model} /> : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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

      {/* 一行状态：当前视图、筛选结果数量与更新时间合并在这里。 */}
      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-1.5 text-[0.6875rem] text-muted-foreground">
        <span>
          {viewLabel} · {model.groups.length} 个端口 / {model.totals.bindings}{" "}
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
            <AlertDialogCancel disabled={submission.busy}>
              取消
            </AlertDialogCancel>
            <ActionButton
              busy={submission.busy}
              busyLabel="结束中…"
              onClick={() => {
                if (pendingConfirm)
                  void submission.submit(pendingConfirm.onConfirm)
              }}
            >
              {pendingConfirm?.confirmText ?? "确认"}
            </ActionButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

type StatItemProps = {
  label: string
  value: number
}

/** 顶部摘要里的一项统计：只报数字，说明文字不占高度。 */
const StatItem = (props: StatItemProps) => (
  <span className="flex items-center gap-1">
    {props.label}
    <span className="font-medium text-foreground tabular-nums">
      {props.value}
    </span>
  </span>
)
