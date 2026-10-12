import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@web/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@web/components/ui/collapsible"
import { ToggleGroup, ToggleGroupItem } from "@web/components/ui/toggle-group"
import type {
  PortExposureFilter,
  PortProtocolFilter,
  PortScopeFilter,
} from "@web/features/ports/store"
import type { usePorts } from "@web/features/ports/usePorts"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import { useState } from "react"

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

/** 表格上方的筛选条：协议、状态、暴露范围。手机上收成一行，按需展开。 */
export const PortFilterBar = (props: PortFilterBarProps) => {
  const { model } = props
  const isDesktop = useIsDesktop()
  const [open, setOpen] = useState(false)

  const groups = (
    <>
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
    </>
  )

  if (isDesktop) {
    return (
      <div className="flex flex-wrap items-center gap-4 border-b px-4 py-2">
        {groups}
      </div>
    )
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <CollapsibleTrigger
          render={<Button variant="outline" size="sm" className="min-h-11" />}
        >
          <HugeiconsIcon
            icon={open ? ArrowUp01Icon : ArrowDown01Icon}
            aria-hidden="true"
          />
          详细筛选
        </CollapsibleTrigger>
        <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-muted-foreground">
          {activeSummaryOf(model)}
        </span>
      </div>
      <CollapsibleContent>
        <div className="flex flex-col items-start gap-2 px-4 pb-3">
          {groups}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** 手机上折叠时也要能看出当前筛选条件：只列非「全部」的项。 */
const activeSummaryOf = (model: ReturnType<typeof usePorts>): string => {
  const active = [
    activeLabel(PROTOCOL_OPTIONS, model.protocol),
    activeLabel(SCOPE_OPTIONS, model.scope),
    activeLabel(EXPOSURE_OPTIONS, model.exposure),
  ].filter((label): label is string => label !== null)
  return active.length === 0 ? "未设置筛选条件" : active.join(" · ")
}

const activeLabel = (
  options: { value: string; label: string }[],
  value: string
): string | null => {
  if (value === "all") return null
  return options.find((option) => option.value === value)?.label ?? value
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
