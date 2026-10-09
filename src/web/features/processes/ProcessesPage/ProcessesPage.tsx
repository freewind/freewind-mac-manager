import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Copy01Icon,
  CpuIcon,
  Delete02Icon,
  EyeIcon,
  HardDriveIcon,
  InformationCircleIcon,
  LockIcon,
  MemoryStickIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  Search01Icon,
  ServerStack01Icon,
  Wifi01Icon,
} from "@hugeicons/core-free-icons"
import { useMemo, useState, type ReactNode } from "react"
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
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import { Checkbox } from "@web/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@web/components/ui/dropdown-menu"
import { Input } from "@web/components/ui/input"
import { ScrollArea } from "@web/components/ui/scroll-area"
import { Separator } from "@web/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@web/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import type {
  MachineInfo,
  ProcessInfo,
  ProcessKind,
  ProcessState,
  SystemOverview,
} from "@web/features/processes/mock-data"
import {
  useProcesses,
  type ProcessScope,
} from "@web/features/processes/useProcesses"
import { cn } from "@web/lib/utils"

const SCOPE_OPTIONS: { key: ProcessScope; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "mine", label: "我的进程" },
  { key: "system", label: "系统进程" },
  { key: "ports", label: "占用端口" },
]

const STATE_LABEL: Record<ProcessState, string> = {
  running: "运行中",
  sleeping: "休眠",
  idle: "空闲",
  stopped: "已停止",
  zombie: "僵尸",
}

const STATE_VARIANT: Record<
  ProcessState,
  "default" | "secondary" | "outline" | "destructive"
> = {
  running: "default",
  sleeping: "secondary",
  idle: "outline",
  stopped: "destructive",
  zombie: "destructive",
}

const KIND_LABEL: Record<ProcessKind, string> = {
  kernel: "内核",
  daemon: "系统服务",
  app: "应用",
  helper: "辅助进程",
  service: "后台服务",
}

const AVATAR_TONES = [
  "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300",
  "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300",
  "bg-orange-500/15 text-orange-600 dark:text-orange-300",
]

const TONE_CLASS = {
  normal: "bg-primary/70",
  warning: "bg-amber-500",
  danger: "bg-destructive",
} as const

type Tone = keyof typeof TONE_CLASS

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${Math.max(0, Math.floor(seconds))} 秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时 ${minutes % 60} 分`
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`
}

const formatRate = (bytesPerSecond: number): string =>
  `${formatBytes(bytesPerSecond)}/s`

const cpuTone = (cpu: number): Tone =>
  cpu >= 20 ? "danger" : cpu >= 5 ? "warning" : "normal"

const toneForName = (name: string): string => {
  let hash = 0
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 9973
  return AVATAR_TONES[hash % AVATAR_TONES.length]
}

export const ProcessesPage = () => {
  const model = useProcesses()
  const [pending, setPending] = useState<{
    items: ProcessInfo[]
    force: boolean
  } | null>(null)

  const selected = model.selected
  const childrenOfSelected = useMemo(
    () =>
      selected === null
        ? []
        : model.all.filter((item) => item.ppid === selected.pid),
    [model.all, selected]
  )
  const parentOfSelected = useMemo(
    () =>
      selected === null
        ? null
        : (model.all.find((item) => item.pid === selected.ppid) ?? null),
    [model.all, selected]
  )

  const requestTerminate = (items: ProcessInfo[], force: boolean) => {
    if (items.length === 0) return
    setPending({ items, force })
  }

  const checkedItems = useMemo(
    () => model.all.filter((item) => model.checked.includes(item.pid)),
    [model.all, model.checked]
  )

  const checkedSummary = useMemo(() => {
    const cpu = checkedItems.reduce((sum, item) => sum + item.cpu, 0)
    const memory = checkedItems.reduce((sum, item) => sum + item.memoryBytes, 0)
    return `合计 ${cpu.toFixed(1)}% CPU · ${formatBytes(memory)} 内存`
  }, [checkedItems])

  const allChecked = model.rows.length > 0 && model.checked.length === model.rows.length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-medium">进程管理</h1>
          <span className="hidden text-[0.6875rem] text-muted-foreground lg:inline">
            {model.machine.name} · {model.machine.chip} · {model.overview.cores} 核 ·{" "}
            {formatBytes(model.overview.memoryTotalBytes)} 内存
          </span>
          <div className="relative ml-auto w-64">
            <HugeiconsIcon
              icon={Search01Icon}
              className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={model.keyword}
              onChange={(event) => model.setKeyword(event.target.value)}
              placeholder="搜索进程名、PID、用户、端口"
              className="pl-7"
            />
          </div>
          <div className="flex items-center gap-0.5 rounded-md border p-0.5">
            {SCOPE_OPTIONS.map((option) => (
              <Button
                key={option.key}
                variant={model.scope === option.key ? "secondary" : "ghost"}
                size="xs"
                onClick={() => model.setScope(option.key)}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <Button
            variant={model.autoRefresh ? "secondary" : "outline"}
            size="sm"
            onClick={model.toggleAutoRefresh}
          >
            <HugeiconsIcon icon={model.autoRefresh ? PauseIcon : PlayIcon} />
            {model.autoRefresh ? "自动刷新" : "已暂停"}
          </Button>
          <Button variant="outline" size="sm" onClick={model.refresh}>
            <HugeiconsIcon icon={RefreshIcon} />
            立即刷新
          </Button>
        </div>

        <OverviewCards
          overview={model.overview}
          history={model.cpuHistory}
          machine={model.machine}
        />

        <div className="flex items-center gap-3 text-[0.6875rem] text-muted-foreground">
          <span>
            {model.autoRefresh
              ? `上次更新 ${model.secondsSinceUpdate} 秒前`
              : "已暂停自动刷新"}
          </span>
          <span>
            显示 {model.rows.length} / {model.total} 个进程
          </span>
          {model.notice ? (
            <span className="truncate text-foreground">{model.notice}</span>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={(next: boolean) => model.setAllChecked(next)}
                  aria-label="全选"
                />
              </TableHead>
              <SortableHead
                label="进程名称"
                active={model.sortKey === "name"}
                descending={model.descending}
                onClick={() => model.toggleSort("name")}
                className="min-w-64"
              />
              <SortableHead
                label="PID"
                active={model.sortKey === "pid"}
                descending={model.descending}
                onClick={() => model.toggleSort("pid")}
                className="w-16"
              />
              <TableHead className="w-20">用户</TableHead>
              <TableHead className="w-20">状态</TableHead>
              <SortableHead
                label="CPU"
                active={model.sortKey === "cpu"}
                descending={model.descending}
                onClick={() => model.toggleSort("cpu")}
                className="w-28"
              />
              <SortableHead
                label="内存"
                active={model.sortKey === "memory"}
                descending={model.descending}
                onClick={() => model.toggleSort("memory")}
                className="w-36"
              />
              <SortableHead
                label="线程"
                active={model.sortKey === "threads"}
                descending={model.descending}
                onClick={() => model.toggleSort("threads")}
                className="w-14"
              />
              <TableHead className="w-32">端口</TableHead>
              <SortableHead
                label="运行时长"
                active={model.sortKey === "started"}
                descending={model.descending}
                onClick={() => model.toggleSort("started")}
                className="w-24"
              />
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {model.rows.map((item) => (
              <ProcessRow
                key={item.pid}
                item={item}
                currentUser={model.machine.user}
                checked={model.checked.includes(item.pid)}
                memoryRatio={item.memoryBytes / model.peakMemoryBytes}
                uptimeSeconds={model.nowMs / 1000 - item.startedAt}
                onCheck={model.toggleChecked}
                onOpen={model.openDetail}
                onTerminate={requestTerminate}
              />
            ))}
            {model.rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={11}
                  className="py-10 text-center text-xs text-muted-foreground"
                >
                  没有匹配的进程
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      {checkedItems.length > 0 ? (
        <div className="flex items-center gap-2 border-t bg-muted/40 px-4 py-2 text-[0.6875rem]">
          <span>已选 {checkedItems.length} 个进程</span>
          <span className="text-muted-foreground">{checkedSummary}</span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => requestTerminate(checkedItems, false)}
          >
            结束进程
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => requestTerminate(checkedItems, true)}
          >
            强制结束
          </Button>
          <Button variant="ghost" size="sm" onClick={model.clearChecked}>
            取消选择
          </Button>
        </div>
      ) : null}

      <footer className="flex items-center gap-4 border-t px-4 py-1.5 text-[0.6875rem] text-muted-foreground">
        <span>{model.total} 个进程</span>
        <span>{model.overview.threadCount} 个线程</span>
        <span>CPU 总占用 {model.overview.cpuTotal.toFixed(1)}%</span>
        <span>
          内存 {formatBytes(model.overview.memoryUsedBytes)} /{" "}
          {formatBytes(model.overview.memoryTotalBytes)}
        </span>
        <span className="ml-auto flex items-center gap-3">
          <span>{model.machine.osVersion}</span>
          <span>
            已运行{" "}
            {formatDuration(model.nowMs / 1000 - model.machine.bootAt)}
          </span>
        </span>
      </footer>

      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) model.closeDetail()
        }}
      >
        <SheetContent className="gap-0 p-0 sm:max-w-md">
          {selected !== null ? (
            <>
              <SheetHeader className="gap-2 border-b p-5">
                <span className="flex items-center gap-2.5">
                  <ProcessAvatar name={selected.name} className="size-9 rounded-lg text-sm" />
                  <span className="flex min-w-0 flex-col gap-1">
                    <SheetTitle className="truncate">{selected.name}</SheetTitle>
                    <SheetDescription className="flex items-center gap-2">
                      <span>PID {selected.pid}</span>
                      <span>·</span>
                      <span>{KIND_LABEL[selected.kind]}</span>
                      <span>·</span>
                      <span>{selected.user}</span>
                    </SheetDescription>
                  </span>
                  <Badge
                    variant={STATE_VARIANT[selected.state]}
                    className="ml-auto"
                  >
                    {STATE_LABEL[selected.state]}
                  </Badge>
                </span>
                <code className="mt-1 block rounded-md bg-muted/60 px-2 py-1.5 text-[0.6875rem] break-all text-muted-foreground">
                  {selected.command}
                </code>
              </SheetHeader>

              <ScrollArea className="min-h-0 flex-1">
                <div className="flex flex-col gap-4 p-5">
                  <section className="flex flex-col gap-0.5">
                    <h2 className="pb-1 text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
                      资源占用
                    </h2>
                    <DetailRow label="CPU">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "tabular-nums",
                            selected.cpu >= 20 ? "text-destructive" : undefined
                          )}
                        >
                          {selected.cpu.toFixed(1)}%
                        </span>
                        <MeterBar
                          ratio={selected.cpu / 100}
                          tone={cpuTone(selected.cpu)}
                        />
                      </span>
                    </DetailRow>
                    <DetailRow label="内存">
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums">
                          {formatBytes(selected.memoryBytes)}
                        </span>
                        <MeterBar
                          ratio={selected.memoryBytes / model.peakMemoryBytes}
                          tone={selected.memoryBytes / model.peakMemoryBytes >= 0.6 ? "danger" : "normal"}
                        />
                      </span>
                    </DetailRow>
                    <DetailRow label="能量影响">
                      {selected.energyImpact} / 100
                    </DetailRow>
                    <DetailRow label="线程">{selected.threads}</DetailRow>
                    <DetailRow label="打开文件">
                      {selected.openFiles}
                    </DetailRow>
                    <DetailRow label="磁盘读写">
                      {formatRate(selected.diskReadBytesPerSec)} /{" "}
                      {formatRate(selected.diskWriteBytesPerSec)}
                    </DetailRow>
                    <DetailRow label="网络收发">
                      {formatRate(selected.networkInBytesPerSec)} /{" "}
                      {formatRate(selected.networkOutBytesPerSec)}
                    </DetailRow>
                  </section>

                  <Separator />

                  <section className="flex flex-col gap-0.5">
                    <h2 className="pb-1 text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
                      进程信息
                    </h2>
                    <DetailRow label="父进程">
                      {parentOfSelected === null ? (
                        <span className="text-muted-foreground">
                          {selected.ppid}（已退出）
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:underline"
                          onClick={() => model.openDetail(parentOfSelected)}
                        >
                          {parentOfSelected.name}
                          <span className="text-muted-foreground">
                            （{parentOfSelected.pid}）
                          </span>
                        </button>
                      )}
                    </DetailRow>
                    <DetailRow label="启动于">
                      {new Date(selected.startedAt * 1000).toLocaleString("zh-CN")}
                    </DetailRow>
                    <DetailRow label="已运行">
                      {formatDuration(model.nowMs / 1000 - selected.startedAt)}
                    </DetailRow>
                    <DetailRow label="可执行文件">
                      <code className="text-[0.6875rem]">{selected.path}</code>
                    </DetailRow>
                    <DetailRow label="Bundle ID">
                      {selected.bundleId === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <code className="text-[0.6875rem]">
                          {selected.bundleId}
                        </code>
                      )}
                    </DetailRow>
                    <DetailRow label="监听端口">
                      {selected.ports.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {selected.ports.map((port) => (
                            <Badge key={port} variant="outline">
                              :{port}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </DetailRow>
                  </section>

                  <Separator />

                  <section className="flex flex-col gap-2">
                    <h2 className="text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
                      子进程（{childrenOfSelected.length}）
                    </h2>
                    {childrenOfSelected.length === 0 ? (
                      <p className="text-muted-foreground">没有子进程</p>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        {childrenOfSelected.map((child) => (
                          <button
                            key={child.pid}
                            type="button"
                            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/60"
                            onClick={() => model.openDetail(child)}
                          >
                            <ProcessAvatar name={child.name} />
                            <span className="min-w-0 flex-1 truncate">
                              {child.name}
                            </span>
                            <span className="tabular-nums text-muted-foreground">
                              {child.pid}
                            </span>
                            <span className="w-14 text-right tabular-nums text-muted-foreground">
                              {child.cpu.toFixed(1)}%
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              </ScrollArea>

              <div className="flex items-center gap-2 border-t p-4">
                {selected.user !== model.machine.user ? (
                  <span className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
                    <HugeiconsIcon icon={LockIcon} className="size-3.5" />
                    系统进程，需要管理员权限
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
                    <HugeiconsIcon icon={InformationCircleIcon} className="size-3.5" />
                    结束前请确认进程不需要保存数据
                  </span>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  className="ml-auto"
                  onClick={() => requestTerminate([selected], true)}
                >
                  强制结束
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => requestTerminate([selected], false)}
                >
                  结束进程
                </Button>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

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
              {pending !== null
                ? ` 目标：${pending.items
                    .map((item) => `${item.name}（${item.pid}）`)
                    .join("、")}`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
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

type ProcessRowProps = {
  item: ProcessInfo
  currentUser: string
  checked: boolean
  memoryRatio: number
  uptimeSeconds: number
  onCheck: (pid: number, next: boolean) => void
  onOpen: (item: ProcessInfo) => void
  onTerminate: (items: ProcessInfo[], force: boolean) => void
}

const ProcessRow = (props: ProcessRowProps) => {
  const {
    item,
    currentUser,
    checked,
    memoryRatio,
    uptimeSeconds,
    onCheck,
    onOpen,
    onTerminate,
  } = props
  const memoryTone: Tone =
    memoryRatio >= 0.6 ? "danger" : memoryRatio >= 0.25 ? "warning" : "normal"

  return (
    <TableRow
      className="cursor-pointer"
      data-state={checked ? "selected" : undefined}
      onClick={() => onOpen(item)}
    >
      <TableCell onClick={(event) => event.stopPropagation()}>
        <Checkbox
          checked={checked}
          onCheckedChange={(next: boolean) => onCheck(item.pid, next)}
          aria-label={`选择 ${item.name}`}
        />
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-2">
          <ProcessAvatar name={item.name} />
          <span className="min-w-0 truncate">{item.name}</span>
          {item.user !== currentUser ? (
            <Badge variant="outline" className="shrink-0">
              系统
            </Badge>
          ) : null}
          {item.kind === "helper" ? (
            <Badge variant="ghost" className="shrink-0">
              {KIND_LABEL[item.kind]}
            </Badge>
          ) : null}
        </span>
      </TableCell>
      <TableCell className="tabular-nums text-muted-foreground">
        {item.pid}
      </TableCell>
      <TableCell className="truncate text-muted-foreground">
        {item.user}
      </TableCell>
      <TableCell>
        <Badge variant={STATE_VARIANT[item.state]}>
          {STATE_LABEL[item.state]}
        </Badge>
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "w-11 text-right tabular-nums",
              item.cpu >= 20 ? "text-destructive" : undefined
            )}
          >
            {item.cpu.toFixed(1)}%
          </span>
          <MeterBar ratio={item.cpu / 100} tone={cpuTone(item.cpu)} />
        </span>
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-2">
          <span className="w-16 text-right tabular-nums">
            {formatBytes(item.memoryBytes)}
          </span>
          <MeterBar ratio={memoryRatio} tone={memoryTone} />
        </span>
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {item.threads}
      </TableCell>
      <TableCell>
        {item.ports.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {item.ports.map((port) => (
              <Badge key={port} variant="outline">
                :{port}
              </Badge>
            ))}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {formatDuration(uptimeSeconds)}
      </TableCell>
      <TableCell onClick={(event) => event.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-xs" aria-label="更多操作">
                <HugeiconsIcon icon={MoreHorizontalIcon} />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onOpen(item)}>
              <HugeiconsIcon icon={EyeIcon} />
              查看详情
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void navigator.clipboard.writeText(String(item.pid))}
            >
              <HugeiconsIcon icon={Copy01Icon} />
              复制 PID
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onTerminate([item], false)}>
              <HugeiconsIcon icon={Cancel01Icon} />
              结束进程
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onTerminate([item], true)}
            >
              <HugeiconsIcon icon={Delete02Icon} />
              强制结束
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}

type OverviewCardsProps = {
  overview: SystemOverview
  history: number[]
  machine: MachineInfo
}

const OverviewCards = (props: OverviewCardsProps) => {
  const { overview, history, machine } = props
  const memoryRatio = overview.memoryUsedBytes / overview.memoryTotalBytes
  const memoryTone: Tone =
    overview.memoryPressure === "critical"
      ? "danger"
      : overview.memoryPressure === "warning"
        ? "warning"
        : "normal"
  const pressureLabel =
    overview.memoryPressure === "critical"
      ? "内存紧张"
      : overview.memoryPressure === "warning"
        ? "内存偏高"
        : "内存正常"

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <Card size="sm" className="gap-2 py-3">
        <CardHeader className="px-3">
          <CardTitle className="flex items-center gap-1.5 text-xs">
            <HugeiconsIcon icon={CpuIcon} className="size-3.5 text-muted-foreground" />
            CPU
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 px-3">
          <div className="flex items-end justify-between gap-3">
            <span className="text-lg font-medium tabular-nums">
              {overview.cpuTotal.toFixed(1)}%
            </span>
            <Sparkline values={history} />
          </div>
          <div className="flex items-center gap-2 text-[0.625rem] text-muted-foreground">
            <span>用户 {overview.cpuUser.toFixed(1)}%</span>
            <span>系统 {overview.cpuSystem.toFixed(1)}%</span>
            <span>空闲 {overview.cpuIdle.toFixed(1)}%</span>
            <span className="ml-auto">{overview.cores} 核</span>
          </div>
          <div className="text-[0.625rem] text-muted-foreground">
            负载 {overview.loadAverage.map((value) => value.toFixed(2)).join(" / ")}
          </div>
        </CardContent>
      </Card>

      <Card size="sm" className="gap-2 py-3">
        <CardHeader className="px-3">
          <CardTitle className="flex items-center gap-1.5 text-xs">
            <HugeiconsIcon icon={MemoryStickIcon} className="size-3.5 text-muted-foreground" />
            内存
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 px-3">
          <div className="flex items-end justify-between gap-2">
            <span className="text-lg font-medium tabular-nums">
              {formatBytes(overview.memoryUsedBytes)}
            </span>
            <Badge variant={overview.memoryPressure === "normal" ? "secondary" : "destructive"}>
              {pressureLabel}
            </Badge>
          </div>
          <MeterBar ratio={memoryRatio} tone={memoryTone} className="h-2 w-full" />
          <div className="flex items-center gap-2 text-[0.625rem] text-muted-foreground">
            <span>共 {formatBytes(overview.memoryTotalBytes)}</span>
            <span>缓存 {formatBytes(overview.memoryCachedBytes)}</span>
            <span className="ml-auto">
              交换 {formatBytes(overview.swapUsedBytes)}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card size="sm" className="gap-2 py-3">
        <CardHeader className="px-3">
          <CardTitle className="flex items-center gap-1.5 text-xs">
            <HugeiconsIcon icon={HardDriveIcon} className="size-3.5 text-muted-foreground" />
            磁盘
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 px-3">
          <div className="flex items-end justify-between gap-3">
            <span className="text-lg font-medium tabular-nums">
              {formatRate(overview.diskReadBytesPerSec)}
            </span>
            <span className="text-[0.625rem] text-muted-foreground">读取</span>
          </div>
          <MeterBar
            ratio={overview.diskReadBytesPerSec / (48 * 1024 ** 2)}
            tone="normal"
            className="h-2 w-full"
          />
          <MeterBar
            ratio={overview.diskWriteBytesPerSec / (48 * 1024 ** 2)}
            tone="warning"
            className="h-2 w-full"
          />
          <div className="flex items-center gap-2 text-[0.625rem] text-muted-foreground">
            <span>写 {formatRate(overview.diskWriteBytesPerSec)}</span>
            <span className="ml-auto">{machine.diskName}</span>
          </div>
        </CardContent>
      </Card>

      <Card size="sm" className="gap-2 py-3">
        <CardHeader className="px-3">
          <CardTitle className="flex items-center gap-1.5 text-xs">
            <HugeiconsIcon icon={Wifi01Icon} className="size-3.5 text-muted-foreground" />
            网络
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 px-3">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-sm tabular-nums">
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className="size-3.5 text-emerald-500"
              />
              {formatRate(overview.networkInBytesPerSec)}
            </span>
            <span className="flex items-center gap-1.5 text-sm tabular-nums text-muted-foreground">
              <HugeiconsIcon icon={ArrowUp01Icon} className="size-3.5 text-sky-500" />
              {formatRate(overview.networkOutBytesPerSec)}
            </span>
          </div>
          <MeterBar
            ratio={overview.networkInBytesPerSec / (4 * 1024 ** 2)}
            tone="normal"
            className="h-2 w-full"
          />
          <MeterBar
            ratio={overview.networkOutBytesPerSec / (4 * 1024 ** 2)}
            tone="warning"
            className="h-2 w-full"
          />
          <div className="flex items-center gap-2 text-[0.625rem] text-muted-foreground">
            <span className="flex items-center gap-1">
              <HugeiconsIcon icon={ServerStack01Icon} className="size-3" />
              {machine.networkInterface}
            </span>
            <span className="ml-auto">{overview.threadCount} 个线程</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

const Sparkline = ({ values }: { values: number[] }) => {
  const peak = Math.max(20, ...values)
  return (
    <span className="flex h-9 items-end gap-0.5">
      {values.map((value, index) => (
        <span
          key={index}
          className="w-1 rounded-sm bg-primary/60"
          style={{ height: `${Math.max(8, (value / peak) * 100)}%` }}
        />
      ))}
    </span>
  )
}

type MeterBarProps = {
  ratio: number
  tone: Tone
  className?: string
}

const MeterBar = ({ ratio, tone, className }: MeterBarProps) => (
  <span
    className={cn(
      "relative block h-1.5 w-14 shrink-0 overflow-hidden rounded-sm bg-muted",
      className
    )}
  >
    <span
      className={cn("absolute inset-y-0 left-0 rounded-sm", TONE_CLASS[tone])}
      style={{ width: `${Math.min(100, Math.max(2, ratio * 100))}%` }}
    />
  </span>
)

const ProcessAvatar = ({
  name,
  className,
}: {
  name: string
  className?: string
}) => (
  <span
    className={cn(
      "flex size-5 shrink-0 items-center justify-center rounded-[6px] text-[0.625rem] font-semibold",
      toneForName(name),
      className
    )}
  >
    {name.slice(0, 1).toUpperCase()}
  </span>
)

const DetailRow = ({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) => (
  <div className="flex items-start gap-3 py-1">
    <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
    <span className="min-w-0 flex-1 break-all">{children}</span>
  </div>
)

type SortableHeadProps = {
  label: string
  active: boolean
  descending: boolean
  onClick: () => void
  className?: string
}

const SortableHead = (props: SortableHeadProps) => {
  const { label, active, descending, onClick, className } = props
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          active ? "text-foreground" : undefined
        )}
      >
        {label}
        {active ? <span className="text-xs">{descending ? "↓" : "↑"}</span> : null}
      </button>
    </TableHead>
  )
}
