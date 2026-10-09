import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  CpuIcon,
  HardDriveIcon,
  MemoryStickIcon,
  ServerStack01Icon,
  Wifi01Icon,
} from "@hugeicons/core-free-icons"
import { formatBytes } from "@shared/format"
import { Badge } from "@web/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import { Progress } from "@web/components/ui/progress"
import { formatRate, toPercent } from "@web/features/processes/display"
import type {
  MachineInfo,
  SystemOverview,
} from "@web/features/processes/mock-data"

/** 磁盘与网络进度条的满量程，用来把瞬时速率换算成可见长度。 */
const DISK_FULL_SCALE = 48 * 1024 ** 2
const NETWORK_FULL_SCALE = 4 * 1024 ** 2

const PRESSURE_LABEL = {
  normal: "内存正常",
  warning: "内存偏高",
  critical: "内存紧张",
} as const

type ProcessOverviewCardsProps = {
  overview: SystemOverview
  machine: MachineInfo
}

/** 顶部四张概览卡：CPU、内存、磁盘、网络。 */
export const ProcessOverviewCards = (props: ProcessOverviewCardsProps) => {
  const { overview, machine } = props
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <Card size="sm" className="gap-2 py-3">
        <CardHeader className="px-3">
          <CardTitle className="flex items-center gap-1.5 text-xs">
            <HugeiconsIcon
              icon={CpuIcon}
              className="size-3.5 text-muted-foreground"
            />
            CPU
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 px-3">
          <div className="flex items-end justify-between gap-2">
            <span className="text-lg font-medium tabular-nums">
              {overview.cpuTotal.toFixed(1)}%
            </span>
            <span className="text-[0.625rem] text-muted-foreground">
              {overview.cores} 核
            </span>
          </div>
          <Progress value={toPercent(overview.cpuTotal / 100)} />
          <span className="text-[0.625rem] text-muted-foreground">
            用户 {overview.cpuUser.toFixed(1)}% · 系统{" "}
            {overview.cpuSystem.toFixed(1)}% · 空闲{" "}
            {overview.cpuIdle.toFixed(1)}%
          </span>
          <span className="text-[0.625rem] text-muted-foreground">
            负载 {overview.loadAverage.map((value) => value.toFixed(2)).join(" / ")}
          </span>
        </CardContent>
      </Card>

      <Card size="sm" className="gap-2 py-3">
        <CardHeader className="px-3">
          <CardTitle className="flex items-center gap-1.5 text-xs">
            <HugeiconsIcon
              icon={MemoryStickIcon}
              className="size-3.5 text-muted-foreground"
            />
            内存
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 px-3">
          <div className="flex items-end justify-between gap-2">
            <span className="text-lg font-medium tabular-nums">
              {formatBytes(overview.memoryUsedBytes)}
            </span>
            <Badge
              variant={
                overview.memoryPressure === "normal" ? "secondary" : "destructive"
              }
            >
              {PRESSURE_LABEL[overview.memoryPressure]}
            </Badge>
          </div>
          <Progress
            value={toPercent(
              overview.memoryUsedBytes / overview.memoryTotalBytes
            )}
          />
          <span className="text-[0.625rem] text-muted-foreground">
            共 {formatBytes(overview.memoryTotalBytes)} · 缓存{" "}
            {formatBytes(overview.memoryCachedBytes)} · 交换{" "}
            {formatBytes(overview.swapUsedBytes)}
          </span>
        </CardContent>
      </Card>

      <Card size="sm" className="gap-2 py-3">
        <CardHeader className="px-3">
          <CardTitle className="flex items-center gap-1.5 text-xs">
            <HugeiconsIcon
              icon={HardDriveIcon}
              className="size-3.5 text-muted-foreground"
            />
            磁盘
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 px-3">
          <div className="flex items-end justify-between gap-2">
            <span className="text-lg font-medium tabular-nums">
              {formatRate(overview.diskReadBytesPerSec)}
            </span>
            <span className="text-[0.625rem] text-muted-foreground">读取</span>
          </div>
          <Progress
            value={toPercent(overview.diskReadBytesPerSec / DISK_FULL_SCALE)}
          />
          <Progress
            value={toPercent(overview.diskWriteBytesPerSec / DISK_FULL_SCALE)}
          />
          <span className="text-[0.625rem] text-muted-foreground">
            写入 {formatRate(overview.diskWriteBytesPerSec)} · {machine.diskName}
          </span>
        </CardContent>
      </Card>

      <Card size="sm" className="gap-2 py-3">
        <CardHeader className="px-3">
          <CardTitle className="flex items-center gap-1.5 text-xs">
            <HugeiconsIcon
              icon={Wifi01Icon}
              className="size-3.5 text-muted-foreground"
            />
            网络
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 px-3">
          <div className="flex items-end justify-between gap-2">
            <span className="flex items-center gap-1.5 text-lg font-medium tabular-nums">
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className="size-4 text-emerald-500"
              />
              {formatRate(overview.networkInBytesPerSec)}
            </span>
            <span className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
              <HugeiconsIcon
                icon={ArrowUp01Icon}
                className="size-3.5 text-sky-500"
              />
              {formatRate(overview.networkOutBytesPerSec)}
            </span>
          </div>
          <Progress
            value={toPercent(
              overview.networkInBytesPerSec / NETWORK_FULL_SCALE
            )}
          />
          <Progress
            value={toPercent(
              overview.networkOutBytesPerSec / NETWORK_FULL_SCALE
            )}
          />
          <span className="flex items-center gap-1 text-[0.625rem] text-muted-foreground">
            <HugeiconsIcon icon={ServerStack01Icon} className="size-3" />
            {machine.networkInterface} · {overview.threadCount} 个线程
          </span>
        </CardContent>
      </Card>
    </div>
  )
}
