import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Folder01Icon,
  FolderOpenIcon,
  ShrinkDotIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@web/components/ui/button"
import { ScrollArea } from "@web/components/ui/scroll-area"
import { Skeleton } from "@web/components/ui/skeleton"
import { useDirectoryQuery } from "@web/features/files/queries"
import type { FilesModel } from "@web/features/files/useFiles"
import { cn } from "@web/lib/utils"

type DirectoryTreeProps = {
  model: FilesModel
}

/** 左侧目录树：同一列表里按层级缩进、原地展开，不做嵌套容器。 */
export const DirectoryTree = ({ model }: DirectoryTreeProps) => {
  if (model.rootPath === "") {
    return (
      <div className="flex flex-col gap-1 p-2">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <Skeleton key={index} className="h-6 w-full" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="text-xs text-muted-foreground">目录</span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={model.collapseAll}
        >
          <HugeiconsIcon icon={ShrinkDotIcon} />
          全部收起
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 p-1">
          <TreeBranch
            model={model}
            path={model.rootPath}
            name={model.rootPath}
            depth={0}
          />
        </div>
      </ScrollArea>
    </div>
  )
}

type TreeBranchProps = {
  model: FilesModel
  path: string
  name: string
  depth: number
}

/**
 * 一个树节点。只有展开时才渲染子节点，因此收起的分支不会发起请求；
 * 展开的分支与文件表共用同一份目录缓存，不重复请求。
 */
const TreeBranch = ({ model, path, name, depth }: TreeBranchProps) => {
  // 树根常驻展开，不参与「全部收起」；其余节点看 expanded
  const isRoot = path === model.rootPath
  const expanded = isRoot || model.isExpanded(path)
  const query = useDirectoryQuery(path)
  const dirs = (query.data?.entries ?? []).filter(
    (entry) => entry.kind === "dir"
  )
  const isCurrent = model.currentPath === path

  return (
    <>
      <div
        className="flex items-center gap-0.5"
        style={{ paddingLeft: depth * 12 }}
      >
        {isRoot ? (
          <span className="size-6 shrink-0" />
        ) : (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={expanded ? "收起" : "展开"}
            aria-expanded={expanded}
            onClick={() => model.toggleExpanded(path)}
          >
            <HugeiconsIcon
              icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
            />
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className={cn(
            "min-w-0 flex-1 justify-start",
            isCurrent && "bg-muted"
          )}
          onClick={() => model.enterDirectory(path)}
        >
          <HugeiconsIcon icon={expanded ? FolderOpenIcon : Folder01Icon} />
          <span className="truncate">{name}</span>
        </Button>
      </div>
      {expanded
        ? dirs.map((dir) => (
            <TreeBranch
              key={dir.path}
              model={model}
              path={dir.path}
              name={dir.name}
              depth={depth + 1}
            />
          ))
        : null}
    </>
  )
}
