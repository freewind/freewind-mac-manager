import type { MachineOverview, ProcessEntry } from "@shared/api-contract"
import { formatBytes } from "@shared/format"
import { PageHeader } from "@web/components/PageHeader"
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@web/components/ui/collapsible"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@web/components/ui/input-group"
import { Skeleton } from "@web/components/ui/skeleton"
import { Toggle } from "@web/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@web/components/ui/toggle-group"
import { AiAssistantButton } from "@web/features/ai-assistant/AiAssistantButton"
import { buildAiAssistantContext } from "@web/features/ai-assistant/context"
import {
  averageCoreUsage,
  formatDuration,
  formatRate,
  toPercent,
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
import {
  ArrowDown,
  ArrowUp,
  Pause,
  Play,
  RefreshCw,
  Search,
} from "lucide-react"
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
  /** 完整资源卡片默认收起：固定区只占一行摘要，列表拿到主要高度。 */
  const [resourcesOpen, setResourcesOpen] = useState(false)

  useHistoryOverlay(pending !== null, () => setPending(null))

  const requestTerminate = (items: ProcessEntry[], force: boolean) => {
    if (items.length === 0) return
    setPending({ items, force })
  }

  // 只列 PID、名称与资源占用：不带命令行与可执行文件路径，避免把凭据带进上下文。
  const assistantContext = buildAiAssistantContext({
    feature: "进程管理",
    subject: [
      PROCESS_SCOPES.find((item) => item.key === model.scope)?.label ??
        model.scope,
      model.search ? `搜索「${model.search}」` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    cachedAt: model.updatedAt,
    status: model.error ? "error" : model.isLoading ? "loading" : "ready",
    errorMessage: model.error,
    summary: [
      model.overview
        ? `主机：${model.overview.system.hostname} · ${model.overview.system.chip} · 内存 ${formatBytes(
            model.overview.memory.used
          )} / ${formatBytes(model.overview.memory.total)}`
        : "主机指标：页面尚未获取",
      model.error
        ? "进程：未展示（读取失败，不把缺失当成 0 个进程）"
        : model.isLoading
          ? "进程：页面尚未获取"
          : `进程：共 ${model.processes.length} 个，当前筛选后显示 ${model.filteredProcesses.length} 个，线程合计 ${model.threadCount}`,
      `上次采样：${model.secondsSinceUpdate} 秒前${
        model.autoRefresh ? "（自动刷新中）" : "（自动刷新已暂停）"
      }`,
    ],
    lists: [
      {
        label: "占用 CPU 最高的进程",
        items: [...model.filteredProcesses]
          .sort((left, right) => right.cpu - left.cpu)
          .slice(0, 10)
          .map(
            (item) =>
              `PID ${item.pid} ${item.name} · CPU ${item.cpu.toFixed(
                1
              )}% · 内存 ${formatBytes(item.memoryBytes)} · 用户 ${item.user} · 状态 ${item.state}`
          ),
        total: model.filteredProcesses.length,
      },
    ],
  })

  return (
    <Collapsible
      open={resourcesOpen}
      onOpenChange={setResourcesOpen}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      {/* 固定区只留导航与主要操作，高度让给下面的列表工作区。 */}
      <header className="flex flex-col gap-2 border-b px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <PageHeader title="进程管理" loading={model.isLoading} />
          <InputGroup className="w-full md:ml-auto md:w-64">
            <InputGroupInput
              value={model.search}
              onChange={(event) => model.setSearch(event.target.value)}
              placeholder="搜索进程名、PID、用户、端口"
            />
            <InputGroupAddon>
              <Search />
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
            {model.autoRefresh ? <Pause /> : <Play />}
            {model.autoRefresh ? "自动刷新" : "已暂停"}
          </Toggle>
          <AiAssistantButton context={assistantContext} />
          <Button variant="outline" size="sm" onClick={model.refresh}>
            <RefreshCw />
            立即刷新
          </Button>
        </div>

        {/* 一行薄摘要：资源占用与采样状态；完整卡片放到列表区里按需展开。 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground">
          <ResourceSummary overview={model.overview} />
          <CollapsibleTrigger
            render={
              <Button variant="ghost" size="xs" className="min-h-7 px-1" />
            }
          >
            {resourcesOpen ? (
              <ArrowUp aria-hidden="true" />
            ) : (
              <ArrowDown aria-hidden="true" />
            )}
            {resourcesOpen ? "收起资源详情" : "资源详情"}
          </CollapsibleTrigger>
          <span className="ml-auto flex items-center gap-3">
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
          </span>
        </div>
      </header>

      <ProcessTable
        model={model}
        onRequestTerminate={requestTerminate}
        resources={
          <CollapsibleContent className="border-b bg-muted/20">
            <div className="flex flex-col gap-2 p-3">
              {model.overview === null ? (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {[0, 1, 2, 3].map((index) => (
                    <Skeleton key={index} className="h-28 rounded-lg" />
                  ))}
                </div>
              ) : (
                <ProcessOverviewCards overview={model.overview} />
              )}
              <span className="text-[0.625rem] text-muted-foreground">
                {model.overview === null
                  ? "资源占用还在采样"
                  : `${model.overview.system.osVersion} · 已运行 ${formatDuration(
                      model.overview.system.uptimeSeconds
                    )}`}
              </span>
            </div>
          </CollapsibleContent>
        }
      />

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
    </Collapsible>
  )
}

/** 固定区里的一行资源摘要：只报关键数字，细节留给可展开的资源详情。 */
const ResourceSummary = (props: { overview: MachineOverview | null }) => {
  const overview = props.overview
  if (overview === null) {
    return <span>正在采样资源占用…</span>
  }
  const { cpu, memory, disk, network, system } = overview
  const primaryDisk = disk[0] ?? null
  return (
    <>
      <span className="hidden truncate lg:inline">
        {system.hostname} · {system.chip}
      </span>
      <span className="tabular-nums">
        CPU {averageCoreUsage(cpu.coreUsage).toFixed(1)}%
      </span>
      <span className="tabular-nums">
        内存 {formatBytes(memory.used)} / {formatBytes(memory.total)}
      </span>
      {primaryDisk === null ? null : (
        <span className="hidden tabular-nums md:inline">
          磁盘{" "}
          {toPercent(
            primaryDisk.total === 0 ? 0 : primaryDisk.used / primaryDisk.total
          ).toFixed(0)}
          %
        </span>
      )}
      <span className="hidden tabular-nums md:inline">
        网络 ↓ {formatRate(network.downloadRate)} ↑{" "}
        {formatRate(network.uploadRate)}
      </span>
    </>
  )
}
