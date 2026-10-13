import type { HardwareOverview } from "@shared/api-contract"
import { PageHeader } from "@web/components/PageHeader"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@web/components/ui/collapsible"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@web/components/ui/empty"
import { Separator } from "@web/components/ui/separator"
import { Skeleton } from "@web/components/ui/skeleton"
import { CircuitBoard, Copy, Download, RefreshCw } from "lucide-react"
import type { ReactNode } from "react"
import {
  formatHardwareBytes,
  formatHardwareValue,
  maskMacAddress,
  maskSensitiveValue,
} from "./display"
import { useHardware } from "./useHardware"

type HardwareGroupProps = {
  title: string
  children: ReactNode
}

const HardwareGroup = ({ title, children }: HardwareGroupProps) => (
  <Card className="min-w-0">
    <Collapsible defaultOpen>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        <CollapsibleTrigger className="rounded-md px-3 text-xs text-muted-foreground hover:bg-muted">
          展开/收起
        </CollapsibleTrigger>
      </CardHeader>
      <CollapsibleContent>
        <CardContent className="min-w-0">{children}</CardContent>
      </CollapsibleContent>
    </Collapsible>
  </Card>
)

type FieldProps = {
  label: string
  value: string | number | boolean | null
}

const Field = ({ label, value }: FieldProps) => (
  <div className="flex min-w-0 flex-col gap-0.5 py-1">
    <span className="text-muted-foreground">{label}</span>
    <span className="break-all font-medium">{formatHardwareValue(value)}</span>
  </div>
)

const SensitiveField = ({
  label,
  value,
  reveal,
  onToggle,
}: {
  label: string
  value: string | null
  reveal: boolean
  onToggle: () => void
}) => (
  <div className="flex min-w-0 flex-col gap-0.5 py-1">
    <span className="text-muted-foreground">{label}</span>
    <button
      type="button"
      className="max-w-full break-all text-left font-medium underline decoration-dotted underline-offset-4"
      aria-label={`${label}，点击${reveal ? "遮蔽" : "显示"}`}
      onClick={onToggle}
    >
      {value === null
        ? "未知"
        : reveal
          ? value
          : label === "MAC 地址"
            ? maskMacAddress(value)
            : maskSensitiveValue(value)}
    </button>
  </div>
)

const Fields = ({ children }: { children: ReactNode }) => (
  <div className="grid min-w-0 grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
    {children}
  </div>
)

const LongList = ({ children }: { children: ReactNode }) => (
  <div className="max-h-72 min-w-0 overflow-auto">
    <div className="divide-y divide-border pr-3">{children}</div>
  </div>
)

const HardwareDetails = ({
  data,
  revealed,
  toggleSensitive,
}: {
  data: HardwareOverview
  revealed: Record<string, boolean>
  toggleSensitive: (key: string) => void
}) => (
  <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
    <HardwareGroup title="整机">
      <Fields>
        <Field label="机型名称" value={data.machine.modelName} />
        <Field label="机型标识" value={data.machine.modelIdentifier} />
        <Field label="处理器" value={data.machine.processorName} />
        <Field label="处理器主频" value={data.machine.processorSpeed} />
        <Field
          label="物理 / 逻辑核心"
          value={`${formatHardwareValue(data.machine.physicalCores)} / ${formatHardwareValue(data.machine.logicalCores)}`}
        />
        <Field
          label="L2 / L3 缓存"
          value={`${formatHardwareValue(data.machine.l2Cache)} / ${formatHardwareValue(data.machine.l3Cache)}`}
        />
        <Field label="超线程" value={data.machine.hyperThreading} />
        <Field
          label="内存总量"
          value={formatHardwareBytes(data.machine.memoryTotal)}
        />
        <Field label="固件版本" value={data.machine.firmwareVersion} />
        <Field label="OS Loader" value={data.machine.osLoaderVersion} />
        <Field
          label="macOS 版本 / Build"
          value={`${formatHardwareValue(data.machine.macOSVersion)} / ${formatHardwareValue(data.machine.build)}`}
        />
        <Field
          label="运行时长"
          value={
            data.machine.uptimeSeconds === null
              ? null
              : `${Math.floor(data.machine.uptimeSeconds / 86400)} 天`
          }
        />
        <Field label="架构" value={data.machine.architecture} />
      </Fields>
    </HardwareGroup>

    <HardwareGroup title="CPU">
      <Fields>
        <Field label="品牌字符串" value={data.cpu.brand} />
        <Field label="物理核心" value={data.cpu.physicalCores} />
        <Field label="逻辑核心" value={data.cpu.logicalCores} />
        <Field label="架构" value={data.cpu.architecture} />
        <Field
          label="主频"
          value={
            data.cpu.frequencyMHz === null
              ? null
              : `${data.cpu.frequencyMHz} MHz`
          }
        />
        <Field label="每核 L2" value={data.cpu.l2CachePerCore} />
        <Field label="L3 缓存" value={data.cpu.l3Cache} />
      </Fields>
    </HardwareGroup>

    <HardwareGroup title="内存">
      <Fields>
        <Field label="总量" value={formatHardwareBytes(data.memory.total)} />
        <Field label="类型" value={data.memory.type} />
        <Field label="速度" value={data.memory.speed} />
        <Field
          label="Swap 总量 / 已用"
          value={`${formatHardwareBytes(data.memory.swapTotal)} / ${formatHardwareBytes(data.memory.swapUsed)}`}
        />
      </Fields>
      <Separator className="my-2" />
      {data.memory.slots.length ? (
        <LongList>
          {data.memory.slots.map((slot) => (
            <Fields
              key={slot.name ?? `${slot.type}-${slot.speed}-${slot.status}`}
            >
              <Field label="插槽" value={slot.name} />
              <Field label="容量" value={formatHardwareBytes(slot.capacity)} />
              <Field
                label="类型 / 速度 / 状态"
                value={`${formatHardwareValue(slot.type)} / ${formatHardwareValue(slot.speed)} / ${formatHardwareValue(slot.status)}`}
              />
            </Fields>
          ))}
        </LongList>
      ) : (
        <p className="text-muted-foreground">暂无插槽信息</p>
      )}
    </HardwareGroup>

    <HardwareGroup title="存储">
      <p className="mb-1 font-medium">卷</p>
      <LongList>
        {data.storage.volumes.map((volume) => (
          <Fields key={volume.mountPoint ?? volume.name ?? "volume-unknown"}>
            <Field
              label="名称 / 挂载点"
              value={`${formatHardwareValue(volume.name)} / ${formatHardwareValue(volume.mountPoint)}`}
            />
            <Field label="文件系统" value={volume.fileSystem} />
            <Field
              label="总量 / 已用 / 可用"
              value={`${formatHardwareBytes(volume.total)} / ${formatHardwareBytes(volume.used)} / ${formatHardwareBytes(volume.available)}`}
            />
            <Field label="可写" value={volume.writable} />
          </Fields>
        ))}
      </LongList>
      <Separator className="my-2" />
      <p className="mb-1 font-medium">设备</p>
      <LongList>
        {data.storage.devices.map((device) => {
          const sensitiveKey = `storage-${device.serialNumber ?? device.model ?? "unknown"}`
          return (
            <Fields key={sensitiveKey}>
              <Field
                label="型号 / 容量"
                value={`${formatHardwareValue(device.model)} / ${formatHardwareBytes(device.capacity)}`}
              />
              <Field
                label="TRIM / SMART"
                value={`${formatHardwareValue(device.trim)} / ${formatHardwareValue(device.smartStatus)}`}
              />
              <SensitiveField
                label="序列号"
                value={device.serialNumber}
                reveal={!!revealed[sensitiveKey]}
                onToggle={() => toggleSensitive(sensitiveKey)}
              />
            </Fields>
          )
        })}
      </LongList>
    </HardwareGroup>

    <HardwareGroup title="图形与显示器">
      <p className="mb-1 font-medium">GPU</p>
      <LongList>
        {data.graphics.gpus.map((gpu) => (
          <Fields key={gpu.deviceId ?? gpu.model ?? "gpu-unknown"}>
            <Field
              label="型号 / 厂商"
              value={`${formatHardwareValue(gpu.model)} / ${formatHardwareValue(gpu.vendor)}`}
            />
            <Field
              label="设备 ID / 总线"
              value={`${formatHardwareValue(gpu.deviceId)} / ${formatHardwareValue(gpu.bus)}`}
            />
            <Field
              label="显存 / PCIe 宽度 / 核心数"
              value={`${formatHardwareBytes(gpu.memory)} / ${formatHardwareValue(gpu.pcieWidth)} / ${formatHardwareValue(gpu.cores)}`}
            />
          </Fields>
        ))}
      </LongList>
      <Separator className="my-2" />
      <p className="mb-1 font-medium">显示器</p>
      <LongList>
        {data.graphics.displays.map((display) => (
          <Fields
            key={`${display.name ?? "display-unknown"}-${display.resolution ?? "resolution-unknown"}`}
          >
            <Field
              label="名称 / 分辨率"
              value={`${formatHardwareValue(display.name)} / ${formatHardwareValue(display.resolution)}`}
            />
            <Field
              label="刷新率 / 尺寸"
              value={`${formatHardwareValue(display.refreshRateHz)} Hz / ${formatHardwareValue(display.sizeInches)} 英寸`}
            />
            <Field
              label="连接 / 主屏"
              value={`${formatHardwareValue(display.connection)} / ${formatHardwareValue(display.isMain)}`}
            />
          </Fields>
        ))}
      </LongList>
    </HardwareGroup>

    <HardwareGroup title="网络">
      <p className="mb-1 font-medium">接口</p>
      <LongList>
        {data.network.interfaces.map((item) => {
          const sensitiveKey = `mac-${item.name ?? item.type ?? "unknown"}`
          return (
            <Fields key={sensitiveKey}>
              <Field
                label="名称 / 类型"
                value={`${formatHardwareValue(item.name)} / ${formatHardwareValue(item.type)}`}
              />
              <SensitiveField
                label="MAC 地址"
                value={item.macAddress}
                reveal={!!revealed[sensitiveKey]}
                onToggle={() => toggleSensitive(sensitiveKey)}
              />
              <Field
                label="IPv4 / IPv6"
                value={`${item.ipv4.join(", ") || "未知"} / ${item.ipv6.join(", ") || "未知"}`}
              />
              <Field
                label="状态 / 速率 / 双工"
                value={`${formatHardwareValue(item.status)} / ${formatHardwareValue(item.speed)} / ${formatHardwareValue(item.duplex)}`}
              />
            </Fields>
          )
        })}
      </LongList>
      <Separator className="my-2" />
      <Fields>
        <Field
          label="Wi-Fi 芯片 / 信道 / PHY"
          value={`${formatHardwareValue(data.network.wifi.chipset)} / ${formatHardwareValue(data.network.wifi.channel)} / ${formatHardwareValue(data.network.wifi.phyMode)}`}
        />
        <Field
          label="Wi-Fi 国家码 / 信号噪声"
          value={`${formatHardwareValue(data.network.wifi.countryCode)} / ${formatHardwareValue(data.network.wifi.signalNoise)}`}
        />
        <Field
          label="蓝牙芯片 / 状态 / 固件"
          value={`${formatHardwareValue(data.network.bluetooth.chipset)} / ${formatHardwareValue(data.network.bluetooth.status)} / ${formatHardwareValue(data.network.bluetooth.firmware)}`}
        />
        <SensitiveField
          label="蓝牙地址"
          value={data.network.bluetooth.address}
          reveal={!!revealed.bluetooth}
          onToggle={() => toggleSensitive("bluetooth")}
        />
      </Fields>
    </HardwareGroup>

    <HardwareGroup title="电源">
      <Fields>
        <Field label="是否有电池" value={data.power.hasBattery} />
        <Field
          label="电源适配器功率 / 连接"
          value={`${formatHardwareValue(data.power.adapter.wattage)} W / ${formatHardwareValue(data.power.adapter.connected)}`}
        />
        {data.power.battery ? (
          <>
            <Field
              label="循环次数 / 状况"
              value={`${formatHardwareValue(data.power.battery.cycleCount)} / ${formatHardwareValue(data.power.battery.condition)}`}
            />
            <Field
              label="健康度"
              value={
                data.power.battery.healthPercent === null
                  ? null
                  : `${data.power.battery.healthPercent}%`
              }
            />
            <Field
              label="最大 / 当前容量"
              value={`${formatHardwareBytes(data.power.battery.maximumCapacity)} / ${formatHardwareBytes(data.power.battery.currentCapacity)}`}
            />
            <Field label="是否充电" value={data.power.battery.isCharging} />
          </>
        ) : null}
      </Fields>
      <Separator className="my-2" />
      <p className="mb-1 font-medium">电源设置</p>
      <LongList>
        {data.power.settings.map((setting) => (
          <p key={setting} className="break-all py-1">
            {setting}
          </p>
        ))}
      </LongList>
    </HardwareGroup>

    <HardwareGroup title="外设">
      <p className="mb-1 font-medium">USB 设备</p>
      <LongList>
        {data.peripherals.usbDevices.map((device) => {
          const sensitiveKey = `usb-${device.serialNumber ?? `${device.productId}-${device.name}`}`
          return (
            <Fields key={sensitiveKey}>
              <Field
                label="名称 / 厂商"
                value={`${formatHardwareValue(device.name)} / ${formatHardwareValue(device.vendor)}`}
              />
              <Field
                label="产品 ID / 速率 / 供电"
                value={`${formatHardwareValue(device.productId)} / ${formatHardwareValue(device.speed)} / ${formatHardwareValue(device.power)}`}
              />
              <SensitiveField
                label="序列号"
                value={device.serialNumber}
                reveal={!!revealed[sensitiveKey]}
                onToggle={() => toggleSensitive(sensitiveKey)}
              />
            </Fields>
          )
        })}
      </LongList>
      <Separator className="my-2" />
      <p className="mb-1 font-medium">音频设备</p>
      <LongList>
        {data.peripherals.audioDevices.map((device) => (
          <Fields
            key={`${device.name ?? "audio-unknown"}-${device.transport ?? "transport-unknown"}`}
          >
            <Field
              label="名称 / 厂商"
              value={`${formatHardwareValue(device.name)} / ${formatHardwareValue(device.vendor)}`}
            />
            <Field
              label="输出声道 / 采样率 / 传输"
              value={`${formatHardwareValue(device.outputChannels)} / ${formatHardwareValue(device.sampleRate)} Hz / ${formatHardwareValue(device.transport)}`}
            />
          </Fields>
        ))}
      </LongList>
      <Fields>
        <Field
          label="摄像头"
          value={data.peripherals.cameras.join("、") || "无"}
        />
        <Field
          label="读卡器"
          value={data.peripherals.cardReaders.join("、") || "无"}
        />
      </Fields>
    </HardwareGroup>

    <HardwareGroup title="系统标识">
      <Fields>
        <SensitiveField
          label="序列号"
          value={data.identity.serialNumber}
          reveal={!!revealed.serial}
          onToggle={() => toggleSensitive("serial")}
        />
        <SensitiveField
          label="Hardware UUID"
          value={data.identity.hardwareUuid}
          reveal={!!revealed.uuid}
          onToggle={() => toggleSensitive("uuid")}
        />
        <SensitiveField
          label="Provisioning UDID"
          value={data.identity.provisioningUdid}
          reveal={!!revealed.udid}
          onToggle={() => toggleSensitive("udid")}
        />
      </Fields>
    </HardwareGroup>
  </div>
)

export const HardwarePage = () => {
  const model = useHardware()
  const data = model.data
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 px-4 py-3">
        <CircuitBoard className="size-4" />
        <PageHeader title="硬件" loading={model.isPending} />
        <Badge variant="outline">含敏感信息</Badge>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void model.copy()}
            disabled={!data}
          >
            <Copy />
            复制文本
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={model.exportText}
            disabled={!data}
          >
            <Download />
            导出
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void model.refresh()}
            disabled={model.isFetching}
          >
            <RefreshCw />
            刷新
          </Button>
        </div>
      </header>
      <Separator />
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-3 sm:p-4">
        {model.error ? (
          <Alert variant="destructive" className="mb-3">
            <AlertTitle>读取硬件信息失败</AlertTitle>
            <AlertDescription>{model.error.message}</AlertDescription>
          </Alert>
        ) : null}
        {model.isPending ? (
          <div
            className="grid grid-cols-1 gap-3 xl:grid-cols-2"
            role="status"
            aria-label="正在读取硬件信息"
          >
            {["machine", "cpu", "memory", "storage"].map((key) => (
              <Skeleton key={key} className="h-40" />
            ))}
          </div>
        ) : data ? (
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              硬件配置与低频变化信息 · 更新于{" "}
              {new Date(data.sampledAt).toLocaleString()}
            </p>
            <HardwareDetails
              data={data}
              revealed={model.revealed}
              toggleSensitive={model.toggleSensitive}
            />
          </>
        ) : !model.error ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>暂无硬件信息</EmptyTitle>
              <EmptyDescription>服务端尚未返回硬件概览。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
      </div>
    </main>
  )
}
