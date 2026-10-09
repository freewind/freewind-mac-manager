import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  CpuIcon,
  HardDriveIcon,
  MemoryStickIcon,
  ServerStack01Icon,
  Wifi01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { MachineOverview } from "@shared/api-contract"
import { formatBytes } from "@shared/format"
import { Badge } from "@web/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import { Progress } from "@web/components/ui/progress"
import {
  averageCoreUsage,
  formatRate,
  toPercent,
} from "@web/features/processes/display"

/** 网络进度条的满量程，用来把瞬时速率换算成可见长度。 */
const NETWORK_FULL_SCALE = 4 * 1024 ** 2

type ProcessOverviewCardsProps = {
  overview: MachineOverview
}

/** 顶部四张概览卡：CPU、内存、磁盘、网络，数据与概览页同源。 */
export const ProcessOverviewCards = (props: ProcessOverviewCardsProps) => {
  const { overview } = props
  const { cpu, memory, disk, network, system } = overview
  const cpuTotal = averageCoreUsage(cpu.coreUsage)
  const primaryDisk = disk[0] ?? null
  const memoryUsedRatio = memory.total === 0 ? 0 : memory.used / memory.total

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
              {cpuTotal.toFixed(1)}%
            </span>
            <span className="text-[0.625rem] text-muted-foreground">
              {cpu.coreCount} 核
            </span>
          </div>
          <Progress value={toPercent(cpuTotal / 100)} />
          <span className="text-[0.625rem] text-muted-foreground">
            负载 {cpu.loadAverage.map((value) => value.toFixed(2)).join(" / ")}
          </span>
          <span className="truncate text-[0.625rem] text-muted-foreground">
            {system.chip}
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
              {formatBytes(memory.used)}
            </span>
            <Badge
              variant={memoryUsedRatio >= 0.85 ? "destructive" : "secondary"}
            >
              共 {formatBytes(memory.total)}
            </Badge>
          </div>
          <Progress value={toPercent(memoryUsedRatio)} />
          <span className="text-[0.625rem] text-muted-foreground">
            联动 {formatBytes(memory.wired)} · 压缩{" "}
            {formatBytes(memory.compressed)}
          </span>
          <span className="text-[0.625rem] text-muted-foreground">
            可用 {formatBytes(memory.free)} · 交换{" "}
            {formatBytes(memory.swapUsed)} / {formatBytes(memory.swapTotal)}
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
          {primaryDisk === null ? (
            <span className="text-[0.625rem] text-muted-foreground">
              读不到卷信息
            </span>
          ) : (
            <>
              <div className="flex items-end justify-between gap-2">
                <span className="text-lg font-medium tabular-nums">
                  {formatBytes(primaryDisk.used)}
                </span>
                <span className="text-[0.625rem] text-muted-foreground">
                  {primaryDisk.name}
                </span>
              </div>
              <Progress
                value={toPercent(
                  primaryDisk.total === 0
                    ? 0
                    : primaryDisk.used / primaryDisk.total
                )}
              />
              <span className="text-[0.625rem] text-muted-foreground">
                共 {formatBytes(primaryDisk.total)} · 剩余{" "}
                {formatBytes(primaryDisk.free)}
              </span>
            </>
          )}
          <span className="truncate text-[0.625rem] text-muted-foreground">
            {disk.length > 1
              ? `另有 ${disk.length - 1} 个卷`
              : `挂载于 ${primaryDisk?.mount ?? "—"}`}
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
              {formatRate(network.downloadRate)}
            </span>
            <span className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
              <HugeiconsIcon
                icon={ArrowUp01Icon}
                className="size-3.5 text-sky-500"
              />
              {formatRate(network.uploadRate)}
            </span>
          </div>
          <Progress
            value={toPercent(network.downloadRate / NETWORK_FULL_SCALE)}
          />
          <Progress
            value={toPercent(network.uploadRate / NETWORK_FULL_SCALE)}
          />
          <span className="flex items-center gap-1 truncate text-[0.625rem] text-muted-foreground">
            <HugeiconsIcon icon={ServerStack01Icon} className="size-3" />
            {network.interfaceName} · {network.address}
          </span>
        </CardContent>
      </Card>
    </div>
  )
}
