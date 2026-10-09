import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  DashboardSpeed02Icon,
  Download01Icon,
  RefreshIcon,
  Upload01Icon,
} from "@hugeicons/core-free-icons"
import { useState, type ReactNode } from "react"
import { formatBytes } from "@shared/format"
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
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import type { TrafficSnapshot } from "@web/features/traffic/mock-data"
import { useTraffic } from "@web/features/traffic/useTraffic"
import { ProcessTable } from "./ProcessTable"
import { SnapshotList } from "./SnapshotList"

type PendingConfirm = {
  title: string
  description: string
  confirmText: string
  onConfirm: () => void
}

export const TrafficPage = () => {
  const model = useTraffic()
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(
    null
  )

  const scopeText = model.isRealtime
    ? "实时（当前正在跑的进程）"
    : model.selectedSnapshotCount > 1
      ? `快照合计（${model.selectedSnapshotCount} 份：${model.selectedSnapshots
          .map((item) => item.rangeText)
          .join("；")}）`
      : model.selectedSnapshots[0]
        ? `快照 ${model.selectedSnapshots[0].rangeText}`
        : "未选择快照"

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      model.notify("已复制到剪贴板")
    } catch {
      model.notify("复制失败：浏览器拒绝了剪贴板访问")
    }
  }

  const requestDeleteSnapshot = (snapshot: TrafficSnapshot) =>
    setPendingConfirm({
      title: "删除这份快照？",
      description: `${snapshot.rangeText} 的增量会并入它后面一份，不会被丢掉。`,
      confirmText: "删除",
      onConfirm: () => model.removeSnapshot(snapshot.id),
    })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <HugeiconsIcon icon={DashboardSpeed02Icon} className="size-4" />
          <h1 className="text-sm font-medium">流量监控</h1>
          <Badge variant="outline">演示数据</Badge>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={model.ignoreProxy}
                onChange={(event) => model.setIgnoreProxy(event.target.checked)}
              />
              忽略代理进程
            </label>
            <Button size="sm" variant="outline" onClick={model.refresh}>
              <HugeiconsIcon icon={RefreshIcon} />
              刷新
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            title={<IconLabel icon={ArrowDown01Icon} text="实时" />}
            value={`${formatBytes(model.status?.downloadRate ?? 0)}/s`}
            description={`每 ${model.status?.intervalSeconds ?? 5} 秒采样一次`}
          />
          <StatCard
            title={<IconLabel icon={ArrowUp01Icon} text="实时" />}
            value={`${formatBytes(model.status?.uploadRate ?? 0)}/s`}
            description={`每 ${model.status?.intervalSeconds ?? 5} 秒采样一次`}
          />
          <StatCard
            title={
              model.isRealtime
                ? "当前累计"
                : model.selectedSnapshotCount > 1
                  ? `${model.selectedSnapshotCount} 份快照合计`
                  : "本快照合计"
            }
            value={formatBytes(model.totals.total)}
            description={
              <span className="flex items-center gap-1">
                <HugeiconsIcon icon={Upload01Icon} className="size-3" />
                {formatBytes(model.totals.bytesIn)}
                <HugeiconsIcon icon={Download01Icon} className="ml-1 size-3" />
                {formatBytes(model.totals.bytesOut)}
              </span>
            }
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <SnapshotList
          model={model}
          onRequestDelete={requestDeleteSnapshot}
          onRequestDeleteSelected={() =>
            setPendingConfirm({
              title: `删除选中的 ${model.selectedSnapshotCount} 份快照？`,
              description: "这些快照的增量会依次并入各自后面一份，不会被丢掉。",
              confirmText: "删除所选",
              onConfirm: model.removeSelected,
            })
          }
          onRequestMergeSelected={() =>
            setPendingConfirm({
              title: `把选中的 ${model.selectedSnapshotCount} 份快照合并成一份？`,
              description:
                "合并后会把它们覆盖的整段变成一份，原来的分份记录不再保留。",
              confirmText: "合并",
              onConfirm: model.mergeSelected,
            })
          }
        />

        <ProcessTable
          model={model}
          scopeText={scopeText}
          onCopy={copyText}
          onRequestKill={(label, pids) =>
            setPendingConfirm({
              title: `结束 ${label} 的 ${pids.length} 个进程？`,
              description: `PID: ${pids.join(", ")}。进程被结束后不可恢复。`,
              confirmText: "结束进程",
              onConfirm: () => model.terminate(label, pids),
            })
          }
        />
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
        <span>
          共 {model.totals.processCount} 个进程
          {model.ignoreProxy && model.hiddenCount > 0
            ? `（已隐藏 ${model.hiddenCount} 个代理进程）`
            : ""}
        </span>
        {model.notice ? (
          <span className="text-foreground">{model.notice}</span>
        ) : null}
        <span className="ml-auto">
          {model.isRealtime
            ? `实时视图（每 ${model.status?.intervalSeconds ?? 5} 秒采样）`
            : model.selectedSnapshotCount > 1
              ? `已选 ${model.selectedSnapshotCount} 份快照，显示合计`
              : model.selectedSnapshots[0]
                ? `快照区间 ${model.selectedSnapshots[0].rangeText}`
                : "尚未选择快照"}
        </span>
      </footer>

      <AlertDialog
        open={pendingConfirm !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingConfirm(null)
          }
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
  title: ReactNode
  value: string
  description: ReactNode
}

const StatCard = (props: StatCardProps) => {
  const { title, value, description } = props
  return (
    <Card className="gap-1 py-3">
      <CardHeader className="px-4">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-lg tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}

const IconLabel = (props: { icon: typeof RefreshIcon; text: string }) => (
  <span className="flex items-center gap-1">
    <HugeiconsIcon icon={props.icon} className="size-3" />
    {props.text}
  </span>
)
