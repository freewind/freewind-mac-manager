import { HugeiconsIcon } from "@hugeicons/react"
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
import { useMemo, type ReactNode } from "react"
import { formatBytes } from "@shared/format"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import { cn } from "@web/lib/utils"
import type { DiskVolume, MemoryInfo } from "@web/features/dashboard/mock-data"
import { useDashboard } from "@web/features/dashboard/useDashboard"

export const DashboardPage = () => {
  const { overview, refresh, paused, setPaused } = useDashboard()
  const { system, cpu, memory, disk, network } = overview

  const processes = useMemo(
    () => [...overview.processes].sort((left, right) => right.cpu - left.cpu),
    [overview.processes]
  )

  const pressure = describeMemoryPressure(memory)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-2 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <HugeiconsIcon icon={CircleGaugeIcon} className="size-4" />
          <h1 className="text-sm font-medium">概览</h1>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              更新于 {formatClock(overview.sampledAt)} · 每 3 秒自动刷新
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPaused(!paused)}
            >
              {paused ? "继续刷新" : "暂停刷新"}
            </Button>
            <Button size="sm" variant="outline" onClick={refresh}>
              <HugeiconsIcon icon={RefreshIcon} />
              刷新
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="text-foreground">{system.hostname}</span>
          <span>{system.model}</span>
          <span>{system.chip}</span>
          <span>{system.osVersion}</span>
          <span>已开机 {formatDuration(system.uptimeSeconds)}</span>
          <span>{system.userCount} 人登录</span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={CpuIcon}
            title="CPU 负载"
            value={`${cpu.loadAverage[0]?.toFixed(2) ?? "0.00"}`}
            description={`${cpu.coreCount} 核 · 1/5/15 分钟：${cpu.loadAverage
              .map((value) => value.toFixed(2))
              .join(" / ")}`}
          >
            <div className="grid grid-cols-4 gap-2">
              {cpu.coreUsage.map((usage, index) => (
                <div key={index} className="flex flex-col gap-1">
                  <Bar ratio={usage / 100} />
                  <span className="text-[0.625rem] text-muted-foreground tabular-nums">
                    核 {index + 1} · {usage.toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </MetricCard>

          <MetricCard
            icon={MemoryStickIcon}
            title="内存"
            value={`${formatBytes(memory.used)} / ${formatBytes(memory.total)}`}
            description={
              <PressureBadge label={pressure.label} level={pressure.level} />
            }
          >
            <div className="flex flex-col gap-2">
              <Bar ratio={memory.used / memory.total} />
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground">
                <span className="flex justify-between">
                  <span>应用</span>
                  <span className="text-foreground tabular-nums">
                    {formatBytes(memory.used)}
                  </span>
                </span>
                <span className="flex justify-between">
                  <span>联动</span>
                  <span className="text-foreground tabular-nums">
                    {formatBytes(memory.wired)}
                  </span>
                </span>
                <span className="flex justify-between">
                  <span>压缩</span>
                  <span className="text-foreground tabular-nums">
                    {formatBytes(memory.compressed)}
                  </span>
                </span>
                <span className="flex justify-between">
                  <span>可用</span>
                  <span className="text-foreground tabular-nums">
                    {formatBytes(memory.free)}
                  </span>
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="flex items-center justify-between text-[0.6875rem] text-muted-foreground">
                  <span>Swap</span>
                  <span
                    className={cn(
                      "tabular-nums",
                      memory.swapUsed / memory.swapTotal > 0.7 &&
                        "text-destructive"
                    )}
                  >
                    {formatBytes(memory.swapUsed)} /{" "}
                    {formatBytes(memory.swapTotal)}
                  </span>
                </span>
                <Bar
                  ratio={memory.swapUsed / memory.swapTotal}
                  tone={
                    memory.swapUsed / memory.swapTotal > 0.7
                      ? "danger"
                      : "primary"
                  }
                />
              </div>
            </div>
          </MetricCard>

          <MetricCard
            icon={HardDriveIcon}
            title="磁盘"
            value={formatBytes(disk.volumes[0]?.used ?? 0)}
            description={`系统盘已用 ${formatPercent(
              (disk.volumes[0]?.used ?? 0) / (disk.volumes[0]?.total ?? 1)
            )} · 可用 ${formatBytes(disk.volumes[0]?.free ?? 0)}`}
          >
            <div className="flex flex-col gap-2">
              {disk.volumes.map((volume) => (
                <VolumeRow key={volume.mount} volume={volume} />
              ))}
            </div>
          </MetricCard>

          <MetricCard
            icon={NetworkIcon}
            title="网络"
            value={`${formatBytes(network.downloadRate)}/s`}
            description={`${network.interfaceName} · ${network.address}`}
          >
            <div className="flex flex-col gap-2 text-[0.6875rem]">
              <span className="flex items-center gap-1 text-muted-foreground">
                <HugeiconsIcon icon={ArrowDown01Icon} className="size-3" />
                下载
                <span className="text-foreground tabular-nums">
                  {formatBytes(network.downloadRate)}/s
                </span>
                <span className="ml-auto tabular-nums">
                  累计 {formatBytes(network.totalDown)}
                </span>
              </span>
              <span className="flex items-center gap-1 text-muted-foreground">
                <HugeiconsIcon icon={ArrowUp01Icon} className="size-3" />
                上传
                <span className="text-foreground tabular-nums">
                  {formatBytes(network.uploadRate)}/s
                </span>
                <span className="ml-auto tabular-nums">
                  累计 {formatBytes(network.totalUp)}
                </span>
              </span>
            </div>
          </MetricCard>
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-3">
              <CardTitle className="text-sm">资源占用最高进程</CardTitle>
              <CardDescription className="text-xs">
                按 CPU 排序，共 {overview.processes.length} 个
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[1%] whitespace-nowrap">
                      进程
                    </TableHead>
                    <TableHead className="w-[1%] whitespace-nowrap">
                      PID
                    </TableHead>
                    <TableHead className="w-[1%] whitespace-nowrap">
                      用户
                    </TableHead>
                    <TableHead className="w-28 text-right whitespace-nowrap">
                      CPU
                    </TableHead>
                    <TableHead className="w-24 text-right whitespace-nowrap">
                      内存
                    </TableHead>
                    <TableHead className="w-full">命令</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {processes.map((item) => (
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
                      <TableCell
                        className="max-w-0 truncate text-xs text-muted-foreground"
                        title={item.command}
                      >
                        {item.command}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-3">
              <CardTitle className="text-sm">本机监听端口</CardTitle>
              <CardDescription className="text-xs">
                共 {overview.ports.length} 个端口在监听
              </CardDescription>
            </CardHeader>
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
                  {overview.ports.map((item) => (
                    <TableRow key={`${item.port}-${item.pid}`}>
                      <TableCell className="font-medium tabular-nums">
                        {item.port}
                      </TableCell>
                      <TableCell>{item.process}</TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {item.pid}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.address === "*" ? "所有网卡" : item.address}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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

const VolumeRow = (props: { volume: DiskVolume }) => {
  const { volume } = props
  const ratio = volume.used / volume.total
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center justify-between text-[0.6875rem] text-muted-foreground">
        <span className="truncate">{volume.name}</span>
        <span className="tabular-nums">
          {formatBytes(volume.used)} / {formatBytes(volume.total)}
        </span>
      </span>
      <Bar ratio={ratio} tone={ratio > 0.8 ? "danger" : "primary"} />
    </div>
  )
}

const Bar = (props: { ratio: number; tone?: "primary" | "danger" }) => {
  const { ratio, tone = "primary" } = props
  const width = Math.max(0, Math.min(1, ratio)) * 100
  return (
    <span className="relative block h-2 w-full overflow-hidden rounded-sm bg-muted">
      <span
        className={cn(
          "absolute inset-y-0 left-0 rounded-sm",
          tone === "danger" ? "bg-destructive/80" : "bg-primary/70"
        )}
        style={{ width: `${width}%` }}
      />
    </span>
  )
}

const PressureBadge = (props: {
  label: string
  level: "ok" | "warn" | "high"
}) => (
  <Badge
    variant={props.level === "ok" ? "secondary" : "destructive"}
    className={cn(props.level === "ok" && "text-muted-foreground")}
  >
    内存压力{props.label}
  </Badge>
)

const describeMemoryPressure = (
  memory: MemoryInfo
): { label: string; level: "ok" | "warn" | "high" } => {
  const usage = (memory.used + memory.wired + memory.compressed) / memory.total
  const swap = memory.swapUsed / memory.swapTotal
  if (usage > 0.85 || swap > 0.85) return { label: "紧张", level: "high" }
  if (usage > 0.7 || swap > 0.6) return { label: "偏高", level: "warn" }
  return { label: "正常", level: "ok" }
}

const formatPercent = (ratio: number): string => `${(ratio * 100).toFixed(0)}%`

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
