import { ScrollArea } from "@web/components/ui/scroll-area"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from "@web/components/ui/item"
import { PORT_VIEWS } from "@web/features/ports/store"
import type { usePorts } from "@web/features/ports/usePorts"

type PortQuickViewsProps = {
  model: ReturnType<typeof usePorts>
}

/** 左栏：端口快捷视图（状态 / 暴露面 / 分类），带实时计数。 */
export const PortQuickViews = (props: PortQuickViewsProps) => {
  const { model } = props

  return (
    <aside className="flex max-h-44 w-full shrink-0 flex-col border-b md:max-h-none md:w-52 md:border-r md:border-b-0">
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
