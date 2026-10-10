import {
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ProcessEntry } from "@shared/api-contract"
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
import { Button } from "@web/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@web/components/ui/input-group"
import { Skeleton } from "@web/components/ui/skeleton"
import { Toggle } from "@web/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@web/components/ui/toggle-group"
import {
  averageCoreUsage,
  formatDuration,
} from "@web/features/processes/display"
import { ProcessDetailSheet } from "@web/features/processes/ProcessesPage/ProcessDetailSheet"
import { ProcessOverviewCards } from "@web/features/processes/ProcessesPage/ProcessOverviewCards"
import { ProcessTable } from "@web/features/processes/ProcessesPage/ProcessTable"
import {
  PROCESS_SCOPES,
  type ProcessScope,
} from "@web/features/processes/store"
import { useProcesses } from "@web/features/processes/useProcesses"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { useState } from "react"

/** 页面级瞬时状态：确认弹窗的目标。
 *  远程数据由 TanStack Query 管，本地共享状态由 Zustand 管，其余留在组件自己的 state。 */
type PendingTerminate = {
  items: ProcessEntry[]
  force: boolean
}

export const ProcessesPage = () => {
  const model = useProcesses()
  const [pending, setPending] = useState<PendingTerminate | null>(null)

  useHistoryOverlay(pending !== null, () => setPending(null))

  const requestTerminate = (items: ProcessEntry[], force: boolean) => {
    if (items.length === 0) return
    setPending({ items, force })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-sm font-medium">进程管理</h1>
          <span className="hidden text-[0.6875rem] text-muted-foreground lg:inline">
            {model.overview === null
              ? "正在采样"
              : `${model.overview.system.hostname} · ${model.overview.system.chip}`}
          </span>
          <InputGroup className="w-full md:ml-auto md:w-64">
            <InputGroupInput
              value={model.search}
              onChange={(event) => model.setSearch(event.target.value)}
              placeholder="搜索进程名、PID、用户、端口"
            />
            <InputGroupAddon>
              <HugeiconsIcon icon={Search01Icon} />
            </InputGroupAddon>
          </InputGroup>
          <ToggleGroup
            value={[model.scope]}
            onValueChange={(values: string[]) => {
              const next = values[0]
              if (next !== undefined) model.setScope(next as ProcessScope)
            }}
            variant="outline"
            size="sm"
          >
            {PROCESS_SCOPES.map((item) => (
              <ToggleGroupItem key={item.key} value={item.key}>
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Toggle
            pressed={model.autoRefresh}
            onPressedChange={model.setAutoRefresh}
            variant="outline"
            size="sm"
          >
            <HugeiconsIcon icon={model.autoRefresh ? PauseIcon : PlayIcon} />
            {model.autoRefresh ? "自动刷新" : "已暂停"}
          </Toggle>
          <Button variant="outline" size="sm" onClick={model.refresh}>
            <HugeiconsIcon icon={RefreshIcon} />
            立即刷新
          </Button>
        </div>

        {model.overview === null ? (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-28 rounded-lg" />
            ))}
          </div>
        ) : (
          <ProcessOverviewCards overview={model.overview} />
        )}

        <div className="flex items-center gap-3 text-[0.6875rem] text-muted-foreground">
          <span>
            {model.autoRefresh
              ? `上次更新 ${model.secondsSinceUpdate} 秒前`
              : "已暂停自动刷新"}
          </span>
          <span>
            显示 {model.filteredProcesses.length} / {model.processes.length}{" "}
            个进程
          </span>
          {model.isFetching ? <span>采样中…</span> : null}
          {model.error === null ? null : (
            <span className="text-destructive">{model.error}</span>
          )}
        </div>
      </header>

      <ProcessTable model={model} onRequestTerminate={requestTerminate} />

      {model.checkedProcesses.length > 0 ? (
        <div className="flex items-center gap-2 border-t bg-muted/40 px-4 py-2 text-[0.6875rem]">
          <span>已选 {model.checkedProcesses.length} 个进程</span>
          <span className="text-muted-foreground">
            合计 {model.checkedSummary.cpu.toFixed(1)}% CPU ·{" "}
            {formatBytes(model.checkedSummary.memory)} 内存
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => requestTerminate(model.checkedProcesses, false)}
          >
            结束进程
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => requestTerminate(model.checkedProcesses, true)}
          >
            强制结束
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => model.setChecked([])}
          >
            取消选择
          </Button>
        </div>
      ) : null}

      <footer className="flex items-center gap-4 border-t px-4 py-1.5 text-[0.6875rem] text-muted-foreground">
        <span>{model.processes.length} 个进程</span>
        <span>{model.threadCount} 个线程</span>
        {model.overview === null ? null : (
          <>
            <span>
              CPU 总占用{" "}
              {averageCoreUsage(model.overview.cpu.coreUsage).toFixed(1)}%
            </span>
            <span>
              内存 {formatBytes(model.overview.memory.used)} /{" "}
              {formatBytes(model.overview.memory.total)}
            </span>
          </>
        )}
        <span className="ml-auto flex items-center gap-3">
          <span>{model.overview?.system.osVersion ?? ""}</span>
          <span>
            已运行 {formatDuration(model.overview?.system.uptimeSeconds ?? 0)}
          </span>
        </span>
      </footer>

      <ProcessDetailSheet model={model} onRequestTerminate={requestTerminate} />

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending !== null && pending.items.length === 1
                ? `结束 ${pending.items[0].name}？`
                : `结束所选的 ${pending?.items.length ?? 0} 个进程？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.force
                ? "强制结束（SIGKILL）会立刻终止进程，它没有机会保存数据。"
                : "结束进程（SIGTERM）会请求进程正常退出，未保存的数据可能丢失。"}
              {pending === null
                ? ""
                : ` 目标：${pending.items
                    .map((item) => `${item.name}（${item.pid}）`)
                    .join("、")}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={model.killBusy}
              variant="destructive"
              onClick={() => {
                const action = pending
                setPending(null)
                if (action !== null) model.terminate(action.items, action.force)
              }}
            >
              {pending?.force ? "强制结束" : "结束进程"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
