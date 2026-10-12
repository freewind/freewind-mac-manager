import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from "@web/components/ui/item"
import { ScrollArea } from "@web/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@web/components/ui/select"
import { PORT_VIEWS, type PortView } from "@web/features/ports/store"
import type { usePorts } from "@web/features/ports/usePorts"

type PortQuickViewsProps = {
  model: ReturnType<typeof usePorts>
}

/** 桌面左栏：端口快捷视图（状态 / 暴露面 / 分类），带实时计数。 */
export const PortQuickViews = (props: PortQuickViewsProps) => {
  const { model } = props

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r">
      <div className="border-b px-3 py-2 text-xs font-medium">快捷视图</div>
      <ScrollArea className="min-h-0 flex-1">
        <ItemGroup className="gap-0">
          {PORT_VIEWS.map((item) => (
            <Item
              key={item.key}
              size="xs"
              variant={model.view === item.key ? "muted" : "default"}
              className="cursor-pointer rounded-none"
              onClick={() => model.setView(item.key)}
            >
              <ItemContent>
                <ItemTitle>{item.label}</ItemTitle>
              </ItemContent>
              <ItemActions>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {model.viewCounts[item.key]}
                </span>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </ScrollArea>
    </aside>
  )
}

/** 手机上的同一条快捷视图：改用选择控件，省下一整块列表面板。 */
export const PortViewSelect = (props: PortQuickViewsProps) => {
  const { model } = props

  return (
    <Select
      value={model.view}
      onValueChange={(next) => {
        if (typeof next === "string") model.setView(next as PortView)
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label="快捷视图"
        className="min-h-11 w-40 shrink-0"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {PORT_VIEWS.map((item) => (
          <SelectItem key={item.key} value={item.key}>
            {item.label}（{model.viewCounts[item.key]}）
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
