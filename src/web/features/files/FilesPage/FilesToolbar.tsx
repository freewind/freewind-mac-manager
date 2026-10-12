import { MoreHorizontalIcon, RefreshIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@web/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@web/components/ui/dropdown-menu"
import type { EntryAction } from "@web/features/files/actions"
import type { FilesModel } from "@web/features/files/useFiles"
import { Fragment } from "react"

type FilesToolbarProps = {
  model: FilesModel
  primaryActions: EntryAction[]
  menuActions: EntryAction[]
}

/** 操作入口的可访问名称带上对象：读屏不会只听到一个笼统的「操作」。
 *  可见文字「操作」始终被包含，满足标签与名称一致。 */
const selectionLabel = (model: FilesModel): string => {
  const selected = model.selectedEntries
  if (selected.length === 1) {
    return `对 ${selected[0]?.name ?? ""} 的操作`
  }
  if (selected.length > 1) {
    return `对选中的 ${selected.length} 个条目的操作`
  }
  return "操作"
}

/** 页头工具栏：新建类动作直接铺开，行相关动作收进「操作」菜单。 */
export const FilesToolbar = ({
  model,
  primaryActions,
  menuActions,
}: FilesToolbarProps) => (
  <div className="flex flex-wrap items-center gap-2">
    {primaryActions.map((action) => (
      <Button
        key={action.key}
        size="sm"
        className="min-h-11"
        variant="outline"
        disabled={action.disabled}
        onClick={action.run}
      >
        <HugeiconsIcon icon={action.icon} />
        {action.label}
      </Button>
    ))}

    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="sm"
            className="min-h-11"
            variant="outline"
            aria-label={selectionLabel(model)}
          />
        }
      >
        <HugeiconsIcon icon={MoreHorizontalIcon} />
        操作
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {menuActions.map((action, index) => (
          <Fragment key={action.key}>
            {action.destructive && !menuActions[index - 1]?.destructive ? (
              <DropdownMenuSeparator />
            ) : null}
            <DropdownMenuItem
              variant={action.destructive ? "destructive" : "default"}
              disabled={action.disabled}
              onClick={action.run}
            >
              <HugeiconsIcon icon={action.icon} />
              {action.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>

    <Button
      size="sm"
      className="min-h-11"
      variant="outline"
      onClick={model.refresh}
    >
      <HugeiconsIcon icon={RefreshIcon} />
      刷新
    </Button>
  </div>
)
