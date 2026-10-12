import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  ClockIcon,
  DashboardSpeed02Icon,
  Download01Icon,
  RefreshIcon,
  Upload01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { TrafficSnapshot } from "@shared/api-contract"
import { describeError, formatBytes } from "@shared/format"
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@web/components/ui/sheet"
import { AiAssistantButton } from "@web/features/ai-assistant/AiAssistantButton"
import { buildAiAssistantContext } from "@web/features/ai-assistant/context"
import { useTraffic } from "@web/features/traffic/useTraffic"
import { useDialogSubmit } from "@web/hooks/use-dialog-submit"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import { useState } from "react"
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
  const isDesktop = useIsDesktop()
  const [snapshotListOpen, setSnapshotListOpen] = useState(false)
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
  useHistoryOverlay(snapshotListOpen, () => setSnapshotListOpen(false))

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

  const snapshotListProps = {
    model,
    onRequestDelete: requestDeleteSnapshot,
    onRequestDeleteSelected: () =>
      setPendingConfirm({
        title: `删除选中的 ${model.selectedSnapshotCount} 份快照？`,
        description: "这些快照的增量会依次并入各自后面一份，不会被丢掉。",
        confirmText: "删除所选",
        onConfirm: model.removeSelected,
      }),
    onRequestMergeSelected: () =>
      setPendingConfirm({
        title: `把选中的 ${model.selectedSnapshotCount} 份快照合并成一份？`,
        description:
          "合并后会把它们覆盖的整段变成一份，原来的分份记录不再保留。",
        confirmText: "合并",
        onConfirm: model.mergeSelected,
      }),
  }

  // 切换实时/快照后明细要回到顶部，但左侧列表的位置保持不动。
  const detailResetKey = model.isRealtime
    ? "realtime"
    : model.selectedIds.join(",")

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-2 border-b px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <HugeiconsIcon
            icon={DashboardSpeed02Icon}
            className="size-4"
            aria-hidden="true"
          />
          <PageHeader title="流量监控" loading={model.isLoading} />

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* 手机上快照列表收进抽屉，把宽度留给明细。 */}
            {isDesktop ? null : (
              <Sheet open={snapshotListOpen} onOpenChange={setSnapshotListOpen}>
                <SheetTrigger
                  render={
                    <Button variant="outline" size="sm" className="min-h-11">
                      <HugeiconsIcon icon={ClockIcon} aria-hidden="true" />
                      快照
                    </Button>
                  }
                />
                <SheetContent side="left" className="gap-2">
                  <SheetHeader>
                    <SheetTitle>选择快照</SheetTitle>
                    <SheetDescription>
                      选一份看历史累计；多选后可以合并或删除。
                    </SheetDescription>
                  </SheetHeader>
                  <SnapshotList {...snapshotListProps} />
                </SheetContent>
              </Sheet>
            )}
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
              <HugeiconsIcon icon={RefreshIcon} aria-hidden="true" />
              刷新
            </Button>
          </div>
        </div>

        {/* 一行摘要：实时速率与当前累计分开标识，不再占三张统计卡片。 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground">
          <Metric
            icon={ArrowDown01Icon}
            label="实时下载"
            value={`${formatBytes(model.status?.downloadRate ?? 0)}/s`}
          />
          <Metric
            icon={ArrowUp01Icon}
            label="实时上传"
            value={`${formatBytes(model.status?.uploadRate ?? 0)}/s`}
          />
          <span className="flex items-center gap-1">
            {model.isRealtime
              ? "当前累计"
              : model.selectedSnapshotCount > 1
                ? `${model.selectedSnapshotCount} 份快照合计`
                : "本快照合计"}
            <span className="font-medium text-foreground tabular-nums">
              {model.groupsFailed
                ? "读取失败"
                : model.groupsLoading
                  ? "读取中…"
                  : formatBytes(model.totals.total)}
            </span>
            {model.groupsFailed ? (
              <span>进程级数据不可用，不代表流量为 0</span>
            ) : (
              <span className="flex items-center gap-1 tabular-nums">
                <HugeiconsIcon
                  icon={Upload01Icon}
                  className="size-3"
                  aria-hidden="true"
                />
                入 {formatBytes(model.totals.bytesIn)}
                <HugeiconsIcon
                  icon={Download01Icon}
                  className="ml-1 size-3"
                  aria-hidden="true"
                />
                出 {formatBytes(model.totals.bytesOut)}
              </span>
            )}
          </span>
          <span className="ml-auto min-w-0 truncate">{scopeText}</span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {isDesktop ? <SnapshotList {...snapshotListProps} /> : null}

        <ProcessTable
          model={model}
          scopeText={scopeText}
          resetKey={detailResetKey}
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

type MetricProps = {
  icon: typeof RefreshIcon
  label: string
  value: string
}

/** 摘要里的一项：图标 + 名称 + 数值，说明文字不再各占一张卡片。 */
const Metric = (props: MetricProps) => (
  <span className="flex items-center gap-1">
    <HugeiconsIcon icon={props.icon} className="size-3" aria-hidden="true" />
    {props.label}
    <span className="font-medium text-foreground tabular-nums">
      {props.value}
    </span>
  </span>
)
