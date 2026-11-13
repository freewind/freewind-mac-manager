import {
  type ScanTaskResult,
  TASK_KINDS,
  type TaskRecord,
} from "@shared/api-contract"
import { triggerScan } from "@shared/client-api"
import { formatBytes, formatSignedBytes } from "@shared/format"
import { scanTaskTarget } from "@shared/task-targets"
import { useQueryClient } from "@tanstack/react-query"
import { ActionButton } from "@web/components/ActionButton"
import { PageHeader } from "@web/components/PageHeader"
import { Button } from "@web/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@web/components/ui/dropdown-menu"
import { Input } from "@web/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@web/components/ui/sheet"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@web/components/ui/toggle-group"
import { IcicleChart } from "@web/features/disk-growth/IcicleChart"
import {
  diskGrowthKeys,
  useSelectionRange,
  useSnapshots,
} from "@web/features/disk-growth/queries"
import { useDiskGrowthLocalStore } from "@web/features/disk-growth/store"
import { registerTaskCompletion } from "@web/features/tasks/completion"
import { taskStatusLabel } from "@web/features/tasks/labels"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import { useTaskAction } from "@web/hooks/use-task-action"
import {
  Clock,
  LoaderCircle,
  MoreHorizontal,
  RefreshCw,
  Search,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { SearchResultTable } from "./search-result-table"
import { SnapshotSidebar } from "./snapshot-sidebar"
import { SortableHead, TreeBranch } from "./tree-branch"

/** 手动扫描没有新快照，提示只需说明与基线的差值。 */
const describeScanComparison = (result: ScanTaskResult): string => {
  if (result.baselineSnapshotId === null) {
    return "扫描完成，暂无历史快照可对比"
  }
  const size = formatSignedBytes(result.deltaTotalSize ?? 0)
  const files = result.deltaFileCount ?? 0
  const fileText =
    files === 0 ? "文件数不变" : `文件 ${files > 0 ? "+" : ""}${files}`
  return `与快照 #${result.baselineSnapshotId} 对比：${size}，${fileText}`
}

/** 顶部只报一句话扫描进度，完整任务详情在任务中心。 */
const scanProgressText = (task: TaskRecord): string => {
  const progress = task.progress
  const parts = [taskStatusLabel(task.status)]
  if (!progress) return parts.join(" · ")
  if (progress.bytesDone !== null && progress.bytesDone > 0) {
    parts.push(
      progress.bytesTotal === null
        ? `${progress.stage}：已统计 ${formatBytes(progress.bytesDone)}`
        : `${progress.stage}：已统计 ${formatBytes(progress.bytesDone)} / ${formatBytes(progress.bytesTotal)}`
    )
    return parts.join(" · ")
  }
  parts.push(
    progress.currentTarget
      ? `${progress.stage}：${progress.currentTarget}`
      : progress.stage
  )
  return parts.join(" · ")
}

export const DiskGrowthPage = () => {
  const { snapshots, isLoading } = useSnapshots()
  const isDesktop = useIsDesktop()
  const [snapshotPanelOpen, setSnapshotPanelOpen] = useState(false)
  const queryClient = useQueryClient()
  const resetForNewSnapshot = useDiskGrowthLocalStore(
    (state) => state.resetForNewSnapshot
  )
  const view = useDiskGrowthLocalStore((state) => state.view)
  const setView = useDiskGrowthLocalStore((state) => state.setView)
  const keyword = useDiskGrowthLocalStore((state) => state.keyword)
  const setKeyword = useDiskGrowthLocalStore((state) => state.setKeyword)
  const collapseAll = useDiskGrowthLocalStore((state) => state.collapseAll)
  const notify = (
    message: string | null,
    type: "success" | "error" = "success"
  ) => {
    if (!message) return
    if (type === "error") toast.error(message)
    else toast.success(message)
  }

  const range = useSelectionRange(snapshots)
  const spanDays = useMemo(() => {
    if (snapshots.length === 0) return 1
    const newest = snapshots.find((item) => item.id === range.scanId)
    const baseline = snapshots.find((item) => item.id === range.baselineScanId)
    if (!newest || !baseline) return 1
    const days = (newest.startedAt - baseline.startedAt) / 86400
    return days > 0 ? days : 1
  }, [snapshots, range.scanId, range.baselineScanId])

  /** 扫描完成后快照列表才需要刷新；扫描进行中保留旧快照，不显示半成品。 */
  const refreshAfterScan = useCallback(() => {
    resetForNewSnapshot()
    void queryClient.invalidateQueries({ queryKey: diskGrowthKeys.snapshots })
  }, [queryClient, resetForNewSnapshot])

  // 定时扫描不由本页发起，因此统一登记一份完成处理，两条路径都能刷新。
  useEffect(() => {
    registerTaskCompletion(TASK_KINDS.diskScan, refreshAfterScan)
  }, [refreshAfterScan])

  useHistoryOverlay(snapshotPanelOpen, () => setSnapshotPanelOpen(false))

  const scan = useTaskAction<ScanTaskResult, undefined>({
    kind: TASK_KINDS.diskScan,
    target: scanTaskTarget("/"),
    run: (requestId) => triggerScan(requestId),
    onCompleted: (result) => {
      refreshAfterScan()
      // 手动扫描只做对比：没有新快照，提示与基线的差值就够。
      if (!result.saved) toast.success(describeScanComparison(result))
    },
  })
  const isSearching = keyword.trim().length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-2 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <PageHeader title="磁盘增长" loading={isLoading} />
          <ToggleGroup
            value={[view]}
            onValueChange={(value: string[]) => {
              if (value[0]) setView(value[0] as typeof view)
            }}
            className="ml-2"
          >
            <ToggleGroupItem value="growth">看增长</ToggleGroupItem>
            <ToggleGroupItem value="size">看大小</ToggleGroupItem>
            <ToggleGroupItem value="icicle">分布图</ToggleGroupItem>
          </ToggleGroup>
          <div className="relative ml-auto w-full md:w-64">
            <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索全库路径"
              className="pl-7"
            />
          </div>
          {/* 手机上快照与区间选择收进抽屉，空间留给结果。 */}
          {isDesktop ? null : (
            <Sheet open={snapshotPanelOpen} onOpenChange={setSnapshotPanelOpen}>
              <SheetTrigger
                render={
                  <Button variant="outline" size="sm">
                    <Clock aria-hidden="true" />
                    快照
                  </Button>
                }
              />
              <SheetContent side="left" className="gap-2">
                <SheetHeader>
                  <SheetTitle>快照与区间</SheetTitle>
                  <SheetDescription>
                    选一份看当时的增减；多选后可合并或删除。
                  </SheetDescription>
                </SheetHeader>
                <SnapshotSidebar
                  snapshots={snapshots}
                  isLoading={isLoading}
                  busiest={scan.busy}
                />
              </SheetContent>
            </Sheet>
          )}
          {/* 次要操作进菜单：搜索与视图切换留在外面。 */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm" aria-label="更多操作">
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={collapseAll}>
                全部收起
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ActionButton
            size="sm"
            busy={scan.busy}
            busyLabel="对比中…"
            onClick={() => void scan.run(undefined)}
          >
            <RefreshCw />
            立即对比
          </ActionButton>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>
            区间 {range.ids.length} 份 / {spanDays.toFixed(1)} 天
          </span>
        </div>
        {/* 顶部只报一句话扫描进度，完整任务详情看任务中心。 */}
        {scan.task ? (
          <div className="flex flex-wrap items-center gap-2 text-[0.6875rem] text-muted-foreground">
            {scan.task.status === "running" ? (
              <LoaderCircle
                className="size-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : null}
            <span className="min-w-0 truncate">
              {scanProgressText(scan.task)}
            </span>
            <span className="ml-auto">详细进度与结果见任务中心</span>
          </div>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {isDesktop ? (
          <SnapshotSidebar
            snapshots={snapshots}
            isLoading={isLoading}
            busiest={scan.busy}
          />
        ) : null}

        {view === "icicle" ? (
          <IcicleChart
            scanId={range.scanId}
            baselineScanId={range.baselineScanId}
            keyword={keyword}
          />
        ) : isSearching ? (
          <SearchResultTable
            scanId={range.scanId}
            baselineScanId={range.baselineScanId}
            keyword={keyword}
            view={view}
            onNotice={notify}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <SortableHead
                    label="名称"
                    sortKey="name"
                    className="min-w-72"
                  />
                  <SortableHead
                    label="大小"
                    sortKey="size"
                    className="w-[1%] text-right whitespace-nowrap"
                  />
                  {view === "size" ? (
                    <SortableHead
                      label="占比"
                      sortKey="size"
                      className="w-[1%] text-right whitespace-nowrap"
                    />
                  ) : (
                    <SortableHead
                      label="增长"
                      sortKey="delta"
                      className="w-[1%] text-right whitespace-nowrap"
                    />
                  )}
                  <TableHead className="w-1/3">路径</TableHead>
                  <TableHead className="w-[1%] whitespace-nowrap text-right">
                    操作
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TreeBranch
                  path=""
                  depth={0}
                  scanId={range.scanId}
                  baselineScanId={range.baselineScanId}
                  view={view}
                  onNotice={notify}
                />
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
