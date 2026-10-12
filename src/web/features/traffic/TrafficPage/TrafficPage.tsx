import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  DashboardSpeed02Icon,
  Download01Icon,
  RefreshIcon,
  Upload01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { TrafficSnapshot } from "@shared/api-contract"
import { describeError, formatBytes } from "@shared/format"
import { ActionButton } from "@web/components/ActionButton"
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import { AiAssistantButton } from "@web/features/ai-assistant/AiAssistantButton"
import { buildAiAssistantContext } from "@web/features/ai-assistant/context"
import { useTraffic } from "@web/features/traffic/useTraffic"
import { useDialogSubmit } from "@web/hooks/use-dialog-submit"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { type ReactNode, useState } from "react"
import { toast } from "sonner"
import { ProcessTable } from "./ProcessTable"
import { SnapshotList } from "./SnapshotList"

type PendingConfirm = {
  title: string
  description: string
  confirmText: string
  onConfirm: () => Promise<boolean>
}

export const TrafficPage = () => {
  const model = useTraffic()
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(
    null
  )

  // 采样与明细是两个频率：采样只读 sqlite，明细含 ps+lsof，不能混为一谈。
  const realtimeFrequencies = `采样每 ${model.samplingIntervalSeconds} 秒 · 明细每 ${model.detailsRefreshSeconds} 秒`

  // 只整理页面上已经显示出来的数据；进程明细未就绪时绝不把 0 当真实值。
  const assistantContext = buildAiAssistantContext({
    feature: "流量监控",
    subject: model.isRealtime
      ? `实时视图（${realtimeFrequencies}）`
      : model.selectedSnapshots[0]
        ? `快照区间 ${model.selectedSnapshots[0].rangeText}${
            model.selectedSnapshotCount > 1
              ? `（已选 ${model.selectedSnapshotCount} 份，显示合计）`
              : ""
          }`
        : "尚未选择快照",
    // 流量侧的时间戳是秒，这里统一换算成毫秒。
    collectedAt: model.status?.sampledAt ? model.status.sampledAt * 1000 : null,
    status: model.error ? "error" : model.isLoading ? "loading" : "ready",
    errorMessage: model.error ? describeError(model.error) : null,
    summary: [
      model.status
        ? `实时速率：下载 ${formatBytes(model.status.downloadRate)}/s、上传 ${formatBytes(model.status.uploadRate)}/s`
        : "实时速率：页面尚未获取",
      model.groupsFailed
        ? "进程明细读取失败，累计与进程数不可用（不把 0 当真实值）"
        : model.groupsLoading
          ? "正在读取进程明细，累计值暂不可用"
          : `累计：${formatBytes(model.totals.total)}（入 ${formatBytes(
              model.totals.bytesIn
            )} / 出 ${formatBytes(model.totals.bytesOut)}）· ${
              model.totals.processCount
            } 个进程`,
      `忽略代理进程：${model.ignoreProxy ? "是" : "否"}${
        model.ignoreProxy && model.hiddenCount > 0
          ? `（已隐藏 ${model.hiddenCount} 个）`
          : ""
      }`,
    ],
    lists:
      model.groupsFailed || model.groupsLoading
        ? []
        : [
            {
              label: "按流量的进程分组",
              items: model.groups
                .slice(0, 10)
                .map(
                  (group) =>
                    `${group.name}：入 ${formatBytes(group.bytesIn)} / 出 ${formatBytes(group.bytesOut)}`
                ),
              total: model.groups.length,
            },
          ],
  })

  const submission = useDialogSubmit(
    () => setPendingConfirm(null),
    model.killBusy || model.snapshotWriteBusy
  )
  useHistoryOverlay(pendingConfirm !== null, () => setPendingConfirm(null))

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
      toast.error("复制失败：浏览器拒绝了剪贴板访问")
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

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <AiAssistantButton context={assistantContext} />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={model.ignoreProxy}
                onChange={(event) => model.setIgnoreProxy(event.target.checked)}
              />
              忽略代理进程
            </label>
            <Button
              size="sm"
              className="min-h-11"
              variant="outline"
              onClick={model.refresh}
            >
              <HugeiconsIcon icon={RefreshIcon} />
              刷新
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            title={<IconLabel icon={ArrowDown01Icon} text="实时" />}
            value={`${formatBytes(model.status?.downloadRate ?? 0)}/s`}
            description={`每 ${model.samplingIntervalSeconds} 秒采样一次`}
          />
          <StatCard
            title={<IconLabel icon={ArrowUp01Icon} text="实时" />}
            value={`${formatBytes(model.status?.uploadRate ?? 0)}/s`}
            description={`每 ${model.samplingIntervalSeconds} 秒采样一次`}
          />
          <StatCard
            title={
              model.isRealtime
                ? "当前累计"
                : model.selectedSnapshotCount > 1
                  ? `${model.selectedSnapshotCount} 份快照合计`
                  : "本快照合计"
            }
            value={
              model.groupsFailed
                ? "读取失败"
                : model.groupsLoading
                  ? "读取中…"
                  : formatBytes(model.totals.total)
            }
            description={
              model.groupsFailed ? (
                "进程级数据不可用，不代表流量为 0"
              ) : (
                <span className="flex items-center gap-1">
                  <HugeiconsIcon icon={Upload01Icon} className="size-3" />
                  {formatBytes(model.totals.bytesIn)}
                  <HugeiconsIcon
                    icon={Download01Icon}
                    className="ml-1 size-3"
                  />
                  {formatBytes(model.totals.bytesOut)}
                </span>
              )
            }
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
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
          {model.groupsFailed
            ? "进程明细读取失败，累计与进程数不可用"
            : model.groupsLoading
              ? "正在读取进程明细…"
              : `共 ${model.totals.processCount} 个进程`}
          {model.ignoreProxy && model.hiddenCount > 0
            ? `（已隐藏 ${model.hiddenCount} 个代理进程）`
            : ""}
        </span>
        <span className="ml-auto">
          {model.isRealtime
            ? `实时视图（${realtimeFrequencies}）`
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
            <AlertDialogCancel disabled={submission.busy}>
              取消
            </AlertDialogCancel>
            <ActionButton
              busy={submission.busy}
              busyLabel="执行中…"
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
