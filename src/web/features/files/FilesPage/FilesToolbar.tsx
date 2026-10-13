import { Button } from "@web/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@web/components/ui/dropdown-menu"
import { Input } from "@web/components/ui/input"
import { Toggle } from "@web/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@web/components/ui/toggle-group"
import type { EntryAction } from "@web/features/files/actions"
import {
  SEARCH_MAX_FILE_BYTES,
  SEARCH_RESULT_LIMIT,
  SEARCH_SUBTREE_DEPTH,
} from "@web/features/files/queries"
import type { FilesModel } from "@web/features/files/useFiles"
import { Folder, MoreHorizontal, RefreshCw } from "lucide-react"
import { Fragment } from "react"

type FilesToolbarProps = {
  model: FilesModel
  primaryActions: EntryAction[]
  menuActions: EntryAction[]
  /** 手机上打开目录抽屉；桌面不传，这个入口也就不出现。 */
  onOpenTree?: () => void
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
  onOpenTree,
}: FilesToolbarProps) => (
  <div className="flex flex-wrap items-center gap-2">
    {onOpenTree ? (
      <Button size="sm" variant="outline" onClick={onOpenTree}>
        <Folder />
        目录
      </Button>
    ) : null}

    {primaryActions.map((action) => (
      <Button
        key={action.key}
        size="sm"
        variant="outline"
        disabled={action.disabled}
        onClick={action.run}
      >
        <action.icon />
        {action.label}
      </Button>
    ))}

    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            aria-label={selectionLabel(model)}
          />
        }
      >
        <MoreHorizontal />
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
              <action.icon />
              {action.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>

    <Button size="sm" variant="outline" onClick={model.refresh}>
      <RefreshCw />
      刷新
    </Button>

    <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
      <Input
        aria-label="搜索文件名或内容"
        className="w-full md:w-56"
        placeholder="搜索文件名或内容"
        value={model.search.query}
        onChange={(event) => model.setSearchQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") model.submitSearch()
        }}
      />
      <ToggleGroup
        value={[model.search.scope]}
        onValueChange={(values) => {
          const next = values[0]
          if (next) model.setSearchScope(next as "current" | "subtree")
        }}
        variant="outline"
        aria-label="搜索范围"
      >
        <ToggleGroupItem value="current">仅当前目录</ToggleGroupItem>
        <ToggleGroupItem value="subtree">含子目录</ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup
        value={[model.search.mode]}
        onValueChange={(values) => {
          const next = values[0]
          if (next)
            model.setSearchMode(next as "substring" | "wildcard" | "exact")
        }}
        variant="outline"
        aria-label="匹配方式"
      >
        <ToggleGroupItem value="substring">子串</ToggleGroupItem>
        <ToggleGroupItem value="wildcard">通配</ToggleGroupItem>
        <ToggleGroupItem value="exact">精确</ToggleGroupItem>
      </ToggleGroup>
      <Toggle
        pressed={model.search.caseSensitive}
        onPressedChange={model.setSearchCaseSensitive}
        variant="outline"
      >
        区分大小写
      </Toggle>
      <Toggle
        pressed={model.search.searchContent}
        onPressedChange={model.setSearchContent}
        variant="outline"
      >
        搜文件内容
      </Toggle>
      <Button
        size="sm"
        onClick={model.submitSearch}
        disabled={model.search.query.trim().length === 0}
      >
        搜索
      </Button>
      <p className="w-full text-xs text-muted-foreground">
        {model.search.scope === "current"
          ? `范围：仅当前目录（不下探子目录）· 最多 ${SEARCH_RESULT_LIMIT} 条`
          : `范围：含子目录（最深 ${SEARCH_SUBTREE_DEPTH} 层）· 最多 ${SEARCH_RESULT_LIMIT} 条`}
        ；搜内容时单文件不超过{" "}
        {Math.round(SEARCH_MAX_FILE_BYTES / (1024 * 1024))} MB，不建索引。
      </p>
    </div>
  </div>
)
