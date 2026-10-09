import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  File01Icon,
  Folder01Icon,
} from "@hugeicons/core-free-icons"
import { useMemo, useState } from "react"
import type { FileEntry } from "@shared/api-contract"
import { formatBytes, formatTimestamp } from "@shared/format"
import { Button } from "@web/components/ui/button"
import { Checkbox } from "@web/components/ui/checkbox"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@web/components/ui/empty"
import { ScrollArea } from "@web/components/ui/scroll-area"
import { Skeleton } from "@web/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import { cn } from "@web/lib/utils"
import { sortEntries, type FileSortKey } from "@web/features/files/domain"
import type { FilesModel } from "@web/features/files/useFiles"

type FileTableProps = {
  model: FilesModel
}

/** 右侧文件表：排序与勾选都在本组件内，不上升为跨组件状态。 */
export const FileTable = ({ model }: FileTableProps) => {
  const [sortKey, setSortKey] = useState<FileSortKey>("name")
  const [descending, setDescending] = useState(false)

  const rows = useMemo(
    () => sortEntries(model.entries, sortKey, descending),
    [model.entries, sortKey, descending]
  )

  const allPaths = rows.map((entry) => entry.path)
  const selectedCount = allPaths.filter((path) => model.isSelected(path)).length
  const allChecked = allPaths.length > 0 && selectedCount === allPaths.length
  const someChecked = selectedCount > 0 && !allChecked

  const onSort = (key: FileSortKey) => {
    if (key === sortKey) {
      setDescending((value) => !value)
      return
    }
    setSortKey(key)
    setDescending(true)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b px-3 py-2 text-xs text-muted-foreground">
        <span>{rows.length} 个条目</span>
        {model.selected.length > 0 ? (
          <span>已选 {model.selected.length} 项</span>
        ) : null}
        {model.isFetching ? <span>读取中…</span> : null}
      </div>

      {model.isLoading && rows.length === 0 ? (
        <div className="flex flex-col gap-1 p-3">
          {[0, 1, 2, 3, 4, 5, 6].map((index) => (
            <Skeleton key={index} className="h-7 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Folder01Icon} />
            </EmptyMedia>
            <EmptyTitle>这个目录是空的</EmptyTitle>
            <EmptyDescription>{model.currentPath}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    aria-label="全选当前目录"
                    checked={allChecked}
                    indeterminate={someChecked}
                    onCheckedChange={(checked) =>
                      model.setSelectedForPaths(checked === true, allPaths)
                    }
                  />
                </TableHead>
                <SortHeader
                  label="名称"
                  sortKey="name"
                  activeKey={sortKey}
                  descending={descending}
                  onSort={onSort}
                />
                <SortHeader
                  label="大小"
                  sortKey="size"
                  activeKey={sortKey}
                  descending={descending}
                  onSort={onSort}
                  className="w-24"
                />
                <SortHeader
                  label="修改时间"
                  sortKey="modified"
                  activeKey={sortKey}
                  descending={descending}
                  onSort={onSort}
                  className="w-40"
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {model.canGoUp ? (
                <TableRow
                  className="cursor-default"
                  onDoubleClick={model.goToParent}
                >
                  <TableCell />
                  <TableCell colSpan={3}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={model.goToParent}
                    >
                      <HugeiconsIcon icon={ArrowUp01Icon} />
                      返回上一层
                    </Button>
                  </TableCell>
                </TableRow>
              ) : null}
              {rows.map((entry) => (
                <FileRow key={entry.path} model={model} entry={entry} />
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      )}
    </div>
  )
}

type SortHeaderProps = {
  label: string
  sortKey: FileSortKey
  activeKey: FileSortKey
  descending: boolean
  onSort: (key: FileSortKey) => void
  className?: string
}

/** 可排序表头：排序状态同时给屏幕阅读器（aria-sort），不只靠图标。 */
const SortHeader = ({
  label,
  sortKey,
  activeKey,
  descending,
  onSort,
  className,
}: SortHeaderProps) => (
  <TableHead
    className={className}
    aria-sort={
      activeKey === sortKey ? (descending ? "descending" : "ascending") : "none"
    }
  >
    <Button
      size="sm"
      variant="ghost"
      className={cn("-ml-2", activeKey === sortKey && "text-foreground")}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {activeKey === sortKey ? (
        <HugeiconsIcon icon={descending ? ArrowDown01Icon : ArrowUp01Icon} />
      ) : null}
    </Button>
  </TableHead>
)

type FileRowProps = {
  model: FilesModel
  entry: FileEntry
}

const FileRow = ({ model, entry }: FileRowProps) => {
  const selected = model.isSelected(entry.path)
  return (
    <TableRow
      data-state={selected ? "selected" : undefined}
      className="cursor-default"
      onClick={() => model.selectOnly(entry.path)}
      onDoubleClick={() => {
        if (entry.kind === "dir") {
          model.enterDirectory(entry.path)
        }
      }}
    >
      <TableCell onClick={(event) => event.stopPropagation()}>
        <Checkbox
          aria-label={`选择 ${entry.name}`}
          checked={selected}
          onCheckedChange={(checked) =>
            model.toggleSelected(entry.path, checked === true)
          }
        />
      </TableCell>
      <TableCell className="max-w-0">
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            icon={entry.kind === "dir" ? Folder01Icon : File01Icon}
            className="shrink-0 text-muted-foreground"
          />
          <span className="truncate">{entry.name}</span>
          {entry.kind === "dir" ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`进入 ${entry.name}`}
              onClick={(event) => {
                event.stopPropagation()
                model.enterDirectory(entry.path)
              }}
            >
              <HugeiconsIcon icon={ArrowRight01Icon} />
            </Button>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {entry.kind === "dir" ? "—" : formatBytes(entry.size)}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatTimestamp(entry.modified)}
      </TableCell>
    </TableRow>
  )
}
