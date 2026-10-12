import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  CircleGaugeIcon,
  CpuIcon,
  HardDriveIcon,
  MemoryStickIcon,
  NetworkIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { DiskVolume } from "@shared/api-contract"
import { formatBytes } from "@shared/format"
import { PageHeader } from "@web/components/PageHeader"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@web/components/ui/empty"
import { Progress } from "@web/components/ui/progress"
import { Separator } from "@web/components/ui/separator"
import { Skeleton } from "@web/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@web/components/ui/tooltip"
import { AiAssistantButton } from "@web/features/ai-assistant/AiAssistantButton"
import { buildAiAssistantContext } from "@web/features/ai-assistant/context"
import { useDashboard } from "@web/features/dashboard/useDashboard"
import { cn } from "@web/lib/utils"
import type { ReactNode } from "react"

/** 端口卡只做摘要：完整列表在「端口管理」页，卡片里不再自己滚。 */
const PORT_SUMMARY_LIMIT = 6

/**
 * 跳到对应功能页。与侧栏用同一套 URL 协议：写 feature 参数后派发 popstate，
 * App 订阅它切页，不做整页刷新。
 */
const openFeature = (feature: "processes" | "ports"): void => {
  const url = new URL(window.location.href)
  url.searchParams.set("feature", feature)
  window.history.pushState(
    { ...window.history.state, macManagerFeature: true },
    "",
    url
  )
  window.dispatchEvent(
    new PopStateEvent("popstate", { state: window.history.state })
  )
}

export const DashboardPage = () => {
  const model = useDashboard()
  const overview = model.overview
  const summaryPorts = model.ports.slice(0, PORT_SUMMARY_LIMIT)

  // 只整理页面上已经显示出来的数据：不取数、不读 DOM，拿不到就写「尚未获取」。
  const assistantContext = buildAiAssistantContext({
    feature: "总览",
    subject: overview
      ? `${overview.system.hostname} · ${overview.system.model} · ${overview.system.chip} · ${overview.system.osVersion}`
      : null,
    collectedAt: overview?.sampledAt ?? null,
    status: overview ? "ready" : model.error ? "error" : "loading",
    errorMessage: model.error,
    summary: overview
      ? [
          `CPU 负载（1/5/15 分钟）：${overview.cpu.loadAverage
            .map((value) => value.toFixed(2))
            .join(" / ")} · ${overview.cpu.coreCount} 核`,
          `内存：${formatBytes(overview.memory.used)} / ${formatBytes(
            overview.memory.total
          )}（可用 ${formatBytes(overview.memory.free)}，交换区 ${formatBytes(
            overview.memory.swapUsed
          )} / ${formatBytes(overview.memory.swapTotal)}）`,
          model.pressure
            ? `内存压力：${model.pressure.label}`
            : "内存压力：页面尚未判定",
          ...overview.disk.map(
            (volume) =>
              `磁盘 ${volume.mount}：${formatBytes(volume.used)} / ${formatBytes(
                volume.total
              )}（名称 ${volume.name}）`
          ),
          `网络 ${overview.network.interfaceName}：下载 ${formatBytes(
            overview.network.downloadRate
          )}/s、上传 ${formatBytes(overview.network.uploadRate)}/s`,
          `已开机 ${formatDuration(overview.system.uptimeSeconds)} · ${
            overview.system.userCount
          } 人登录`,
        ]
      : [],
    lists: [
      {
        label: "占用最高的进程（按 CPU）",
        items: model.processes
          .slice(0, 10)
          .map(
            (item) =>
              `PID ${item.pid} ${item.name} · CPU ${item.cpu.toFixed(1)}% · 内存 ${formatBytes(item.memory)}`
          ),
        total: model.processes.length,
      },
      {
        label: "监听端口",
        items: model.ports
          .slice(0, 10)
          .map(
            (item) =>
              `:${item.port} ${item.process}（PID ${item.pid}）· ${item.address}`
          ),
        total: model.ports.length,
      },
    ],
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 标题区只留导航与动作：主机信息移进主体滚动区，不常驻占高。 */}
      <header className="flex flex-wrap items-center gap-2 px-4 py-3">
        <HugeiconsIcon icon={CircleGaugeIcon} className="size-4" />
        <PageHeader title="概览" loading={model.loading} />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {model.paused
              ? "已暂停自动刷新"
              : overview
                ? `更新于 ${formatClock(overview.sampledAt)} · 每 ${overview.refreshIntervalSeconds} 秒自动刷新`
                : "正在读取状态"}
          </span>
          <AiAssistantButton context={assistantContext} />
          <Button size="sm" variant="outline" onClick={model.togglePaused}>
            {model.paused ? "继续刷新" : "暂停刷新"}
          </Button>
          <Button size="sm" variant="outline" onClick={model.refresh}>
            <HugeiconsIcon icon={RefreshIcon} />
            刷新
          </Button>
        </div>
      </header>
      <Separator />

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {model.error ? (
          <Alert variant="destructive" className="mb-3">
            <AlertTitle>读取本机状态失败</AlertTitle>
            <AlertDescription>{model.error}</AlertDescription>
          </Alert>
        ) : null}

        {/* 主机信息放在主体滚动区里，随页面一起滚。 */}
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">
          {overview ? (
            <>
              <span className="text-foreground">
                {overview.system.hostname}
              </span>
              <span>{overview.system.model}</span>
              <span>{overview.system.chip}</span>
              <span>{overview.system.osVersion}</span>
              <span>
                已开机 {formatDuration(overview.system.uptimeSeconds)}
              </span>
              <span>{overview.system.userCount} 人登录</span>
            </>
          ) : (
            <Skeleton className="h-4 w-64" />
          )}
        </div>

        {overview ? (
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={CpuIcon}
              title="CPU 负载"
              value={(overview.cpu.loadAverage[0] ?? 0).toFixed(2)}
              description={`${overview.cpu.coreCount} 核 · 1/5/15 分钟：${overview.cpu.loadAverage
                .map((value) => value.toFixed(2))
                .join(" / ")}`}
            >
              <div className="grid grid-cols-4 gap-2">
                {overview.cpu.coreUsage.map((usage, coreIndex) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: CPU core positions are stable.
                    key={`core-${coreIndex + 1}`}
                    className="flex flex-col gap-1"
                  >
                    <Progress value={usage} />
                    <span className="text-[0.625rem] text-muted-foreground tabular-nums">
                      核 {coreIndex + 1} · {usage.toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            </MetricCard>

            <MetricCard
              icon={MemoryStickIcon}
              title="内存"
              value={`${formatBytes(overview.memory.used)} / ${formatBytes(overview.memory.total)}`}
              description={
                <Badge
                  variant={
                    model.pressure?.level === "ok" ? "secondary" : "destructive"
                  }
                >
                  内存压力{model.pressure?.label ?? "未知"}
                </Badge>
              }
            >
              <div className="flex flex-col gap-2">
                <Progress
                  value={ratio(overview.memory.used, overview.memory.total)}
                />
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground">
                  <StatRow
                    label="应用"
                    value={formatBytes(overview.memory.used)}
                  />
                  <StatRow
                    label="联动"
                    value={formatBytes(overview.memory.wired)}
                  />
                  <StatRow
                    label="压缩"
                    value={formatBytes(overview.memory.compressed)}
                  />
                  <StatRow
                    label="可用"
                    value={formatBytes(overview.memory.free)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="flex items-center justify-between text-[0.6875rem] text-muted-foreground">
                    <span>Swap</span>
                    <span
                      className={cn(
                        "tabular-nums",
                        swapTight(
                          overview.memory.swapUsed,
                          overview.memory.swapTotal
                        ) && "text-destructive"
                      )}
                    >
                      {formatBytes(overview.memory.swapUsed)} /{" "}
                      {formatBytes(overview.memory.swapTotal)}
                    </span>
                  </span>
                  <Progress
                    value={ratio(
                      overview.memory.swapUsed,
                      overview.memory.swapTotal
                    )}
                  />
                </div>
              </div>
            </MetricCard>

            <MetricCard
              icon={HardDriveIcon}
              title="磁盘"
              value={formatBytes(overview.disk[0]?.used ?? 0)}
              description={`系统盘已用 ${formatPercent(
                ratio(overview.disk[0]?.used ?? 0, overview.disk[0]?.total ?? 1)
              )} · 可用 ${formatBytes(overview.disk[0]?.free ?? 0)}`}
            >
              <div className="flex flex-col gap-2">
                {overview.disk.map((volume) => (
                  <VolumeRow key={volume.mount} volume={volume} />
                ))}
              </div>
            </MetricCard>

            <MetricCard
              icon={NetworkIcon}
              title="网络"
              value={`${formatBytes(overview.network.downloadRate)}/s`}
              description={`${overview.network.interfaceName} · ${overview.network.address}`}
            >
              <div className="flex flex-col gap-2 text-[0.6875rem]">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <HugeiconsIcon icon={ArrowDown01Icon} className="size-3" />
                  下载
                  <span className="text-foreground tabular-nums">
                    {formatBytes(overview.network.downloadRate)}/s
                  </span>
                  <span className="ml-auto tabular-nums">
                    累计 {formatBytes(overview.network.totalDown)}
                  </span>
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <HugeiconsIcon icon={ArrowUp01Icon} className="size-3" />
                  上传
                  <span className="text-foreground tabular-nums">
                    {formatBytes(overview.network.uploadRate)}/s
                  </span>
                  <span className="ml-auto tabular-nums">
                    累计 {formatBytes(overview.network.totalUp)}
                  </span>
                </span>
              </div>
            </MetricCard>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-40" />
            ))}
          </div>
        )}

        <div className="mt-3 grid items-start gap-3 xl:grid-cols-2">
          <Card className="gap-0 py-0">
            <CardHeader className="py-3">
              <CardTitle className="text-sm">资源占用最高进程</CardTitle>
              <CardDescription className="text-xs">
                点表头切换排序，共 {model.processes.length} 个
              </CardDescription>
              <CardAction>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => openFeature("processes")}
                >
                  查看全部进程
                </Button>
              </CardAction>
            </CardHeader>
            <Separator />
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[1%] whitespace-nowrap">
                      <SortButton
                        label="进程"
                        active={model.processSortKey === "name"}
                        descending={model.processDescending}
                        onClick={() => model.setProcessSort("name")}
                      />
                    </TableHead>
                    <TableHead className="w-[1%] whitespace-nowrap">
                      PID
                    </TableHead>
                    <TableHead className="w-[1%] whitespace-nowrap">
                      用户
                    </TableHead>
                    <TableHead className="w-[1%] text-right whitespace-nowrap">
                      <SortButton
                        label="CPU"
                        active={model.processSortKey === "cpu"}
                        descending={model.processDescending}
                        onClick={() => model.setProcessSort("cpu")}
                      />
                    </TableHead>
                    <TableHead className="w-[1%] text-right whitespace-nowrap">
                      <SortButton
                        label="内存"
                        active={model.processSortKey === "memory"}
                        descending={model.processDescending}
                        onClick={() => model.setProcessSort("memory")}
                      />
                    </TableHead>
                    <TableHead className="w-full">命令</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {model.processes.map((item) => (
                    <TableRow key={item.pid}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {item.pid}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.user}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {item.cpu.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatBytes(item.memory)}
                      </TableCell>
                      <TableCell className="max-w-0 truncate text-xs text-muted-foreground">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span className="block truncate">
                                {item.command}
                              </span>
                            }
                          />
                          <TooltipContent className="max-w-lg break-all">
                            {item.command}
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {model.processes.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <HugeiconsIcon icon={CpuIcon} />
                    </EmptyMedia>
                    <EmptyTitle>暂无进程数据</EmptyTitle>
                    <EmptyDescription>
                      等一次采样完成，这里会列出占用最高的进程。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : null}
            </CardContent>
          </Card>

          <Card className="gap-0 py-0">
            <CardHeader className="py-3">
              <CardTitle className="text-sm">本机监听端口</CardTitle>
              <CardDescription className="text-xs">
                {model.ports.length > summaryPorts.length
                  ? `共 ${model.ports.length} 个端口在监听，摘要只列前 ${summaryPorts.length} 个`
                  : `共 ${model.ports.length} 个端口在监听`}
              </CardDescription>
              <CardAction>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => openFeature("ports")}
                >
                  查看全部端口
                </Button>
              </CardAction>
            </CardHeader>
            <Separator />
            {/* 不再限高与内嵌滚动：条目已是摘要，展开交给页面主体滚动。 */}
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[1%] whitespace-nowrap">
                      端口
                    </TableHead>
                    <TableHead className="w-[1%] whitespace-nowrap">
                      进程
                    </TableHead>
                    <TableHead className="w-[1%] whitespace-nowrap">
                      PID
                    </TableHead>
                    <TableHead className="w-full">监听地址</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaryPorts.map((item) => (
                    <TableRow key={`${item.port}-${item.pid}`}>
                      <TableCell className="font-medium tabular-nums">
                        {item.port}
                      </TableCell>
                      <TableCell>{item.process}</TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {item.pid}
                      </TableCell>
                      <TableCell className="break-words text-muted-foreground">
                        {item.address === "*" ? "所有网卡" : item.address}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {model.ports.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <HugeiconsIcon icon={NetworkIcon} />
                    </EmptyMedia>
                    <EmptyTitle>没有端口在监听</EmptyTitle>
                    <EmptyDescription>
                      当前没有进程监听本机端口。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

type MetricCardProps = {
  icon: typeof CpuIcon
  title: string
  value: string
  description: ReactNode
  children: ReactNode
}

const MetricCard = (props: MetricCardProps) => {
  const { icon, title, value, description, children } = props
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardDescription className="flex items-center gap-1.5">
          <HugeiconsIcon icon={icon} className="size-3.5" />
          {title}
        </CardDescription>
        <CardTitle className="text-lg tabular-nums">{value}</CardTitle>
        <div className="text-xs text-muted-foreground">{description}</div>
      </CardHeader>
      <CardContent className="px-4">{children}</CardContent>
    </Card>
  )
}

const StatRow = (props: { label: string; value: string }) => (
  <span className="flex justify-between">
    <span>{props.label}</span>
    <span className="text-foreground tabular-nums">{props.value}</span>
  </span>
)

const VolumeRow = (props: { volume: DiskVolume }) => {
  const { volume } = props
  const usage = ratio(volume.used, volume.total)
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center justify-between gap-2 text-[0.6875rem] text-muted-foreground">
        <Tooltip>
          <TooltipTrigger
            render={<span className="min-w-0 truncate">{volume.name}</span>}
          />
          <TooltipContent className="max-w-lg break-all">
            {volume.name}
          </TooltipContent>
        </Tooltip>
        <span className="tabular-nums">
          {formatBytes(volume.used)} / {formatBytes(volume.total)}
        </span>
      </span>
      <Progress value={usage} />
    </div>
  )
}

type SortButtonProps = {
  label: string
  active: boolean
  descending: boolean
  onClick: () => void
}

const SortButton = (props: SortButtonProps) => {
  const { label, active, descending, onClick } = props
  return (
    <Button
      size="xs"
      variant={active ? "secondary" : "ghost"}
      className="-ml-2"
      onClick={onClick}
    >
      {label}
      {active ? (
        <span className="text-[0.625rem]">{descending ? "▼" : "▲"}</span>
      ) : null}
    </Button>
  )
}

const ratio = (value: number, total: number): number =>
  total <= 0 ? 0 : Math.max(0, Math.min(100, (value / total) * 100))

const swapTight = (used: number, total: number): boolean =>
  total > 0 && used / total > 0.7

const formatPercent = (percent: number): string => `${percent.toFixed(0)}%`

const formatClock = (milliseconds: number): string => {
  const date = new Date(milliseconds)
  const pad = (value: number): string => String(value).padStart(2, "0")
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

const formatDuration = (seconds: number): string => {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${days} 天 ${hours} 小时 ${minutes} 分`
}
