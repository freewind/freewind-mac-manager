import { HugeiconsIcon } from "@hugeicons/react"
import { MoreHorizontalIcon, RefreshIcon } from "@hugeicons/core-free-icons"
import { Fragment } from "react"
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

type FilesToolbarProps = {
  model: FilesModel
  primaryActions: EntryAction[]
  menuActions: EntryAction[]
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
        variant="outline"
        disabled={action.disabled}
        onClick={action.run}
      >
        <HugeiconsIcon icon={action.icon} />
        {action.label}
      </Button>
    ))}

    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
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

    <Button size="sm" variant="outline" onClick={model.refresh}>
      <HugeiconsIcon icon={RefreshIcon} />
      刷新
    </Button>
  </div>
)
