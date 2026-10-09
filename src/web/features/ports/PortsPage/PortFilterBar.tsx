import { ToggleGroup, ToggleGroupItem } from "@web/components/ui/toggle-group"
import type {
  PortExposureFilter,
  PortProtocolFilter,
  PortScopeFilter,
} from "@web/features/ports/store"
import type { usePorts } from "@web/features/ports/usePorts"

const PROTOCOL_OPTIONS: { value: PortProtocolFilter; label: string }[] = [
  { value: "all", label: "全部协议" },
  { value: "TCP", label: "TCP" },
  { value: "UDP", label: "UDP" },
]

const SCOPE_OPTIONS: { value: PortScopeFilter; label: string }[] = [
  { value: "all", label: "全部状态" },
  { value: "listening", label: "仅监听" },
  { value: "connected", label: "仅连接" },
]

const EXPOSURE_OPTIONS: { value: PortExposureFilter; label: string }[] = [
  { value: "all", label: "全部范围" },
  { value: "local", label: "仅本机" },
  { value: "exposed", label: "对外暴露" },
]

type PortFilterBarProps = {
  model: ReturnType<typeof usePorts>
}

/** 表格上方的筛选条：协议、状态、暴露范围。 */
export const PortFilterBar = (props: PortFilterBarProps) => {
  const { model } = props

  return (
    <div className="flex flex-wrap items-center gap-4 border-b px-4 py-2">
      <FilterGroup
        label="协议"
        options={PROTOCOL_OPTIONS}
        value={model.protocol}
        onChange={(value) => model.setProtocol(value as PortProtocolFilter)}
      />
      <FilterGroup
        label="状态"
        options={SCOPE_OPTIONS}
        value={model.scope}
        onChange={(value) => model.setScope(value as PortScopeFilter)}
      />
      <FilterGroup
        label="范围"
        options={EXPOSURE_OPTIONS}
        value={model.exposure}
        onChange={(value) => model.setExposure(value as PortExposureFilter)}
      />
    </div>
  )
}

type FilterGroupProps = {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}

const FilterGroup = (props: FilterGroupProps) => (
  <div className="flex items-center gap-1.5">
    <span className="text-xs text-muted-foreground">{props.label}</span>
    <ToggleGroup
      size="sm"
      value={[props.value]}
      onValueChange={(value: string[]) => {
        if (value[0]) props.onChange(value[0])
      }}
    >
      {props.options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  </div>
)
