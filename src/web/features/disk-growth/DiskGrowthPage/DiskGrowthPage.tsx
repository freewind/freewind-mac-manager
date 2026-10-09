import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight01Icon,
  ArrowUp01Icon,
  File01Icon,
  Folder01Icon,
  RefreshIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons"
import { useMemo, useState } from "react"
import type { GrowthEntry } from "@shared/api-contract"
import { formatBytes, formatSignedBytes, formatTimestamp } from "@shared/format"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import { Input } from "@web/components/ui/input"
import { ScrollArea } from "@web/components/ui/scroll-area"
import { Separator } from "@web/components/ui/separator"
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
import { useDiskGrowth } from "@web/features/disk-growth/useDiskGrowth"

type SortKey = "name" | "size" | "delta"

export const DiskGrowthPage = () => {
  const model = useDiskGrowth()
  const [sortKey, setSortKey] = useState<SortKey>("delta")
  const [descending, setDescending] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)

  const sortedEntries = useMemo(() => {
    const factor = descending ? -1 : 1
    return [...model.entries].sort((left, right) => {
      if (sortKey === "name") {
        return left.name.localeCompare(right.name) * factor
      }
      const leftValue = sortKey === "size" ? left.size : left.delta
      const rightValue = sortKey === "size" ? right.size : right.delta
      return (leftValue - rightValue) * factor
    })
  }, [model.entries, sortKey, descending])

  /** 进入子目录后，首行显示「..」回到上一层。 */
  const parentRow = useMemo<GrowthEntry | null>(() => {
    if (model.path === "") return null
    const index = model.path.lastIndexOf("/")
    const parentPath = index <= 0 ? "" : model.path.slice(0, index)
    return {
      path: parentPath,
      name: "..",
      kind: "dir",
      size: 0,
      delta: 0,
      folded: false,
    }
  }, [model.path])

  const rows = useMemo(
    () =>
      parentRow
        ? [{ entry: parentRow, isParent: true }, ...sortedEntries.map((entry) => ({ entry, isParent: false }))]
        : sortedEntries.map((entry) => ({ entry, isParent: false })),
    [parentRow, sortedEntries]
  )

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setDescending((previous) => !previous)
      return
    }
    setSortKey(key)
    setDescending(true)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={model.goUp}
            disabled={model.path === "" || model.keyword.trim().length > 0}
            aria-label="返回上一层"
          >
            <HugeiconsIcon icon={ArrowUp01Icon} />
          </Button>
          <nav className="flex min-w-0 flex-1 items-center gap-1 text-sm">
            {model.breadcrumbs.map((crumb, index) => (
              <span key={crumb.path} className="flex items-center gap-1">
                {index > 0 ? <span className="text-muted-foreground">/</span> : null}
                <button
                  type="button"
                  className="rounded px-1 hover:bg-accent"
                  onClick={() => model.goTo(crumb.path)}
                >
                  {crumb.title}
                </button>
              </span>
            ))}
          </nav>
          <div className="relative w-56">
            <HugeiconsIcon
              icon={Search01Icon}
              className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={model.keyword}
              onChange={(event) => model.setKeyword(event.target.value)}
              placeholder="搜索全库路径"
              className="pl-7"
            />
          </div>
          <Button
            size="sm"
            onClick={() => void model.scanNow()}
            disabled={model.status?.running ?? false}
          >
            <HugeiconsIcon icon={RefreshIcon} />
            立即扫描
          </Button>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{model.status?.phase ?? "尚未扫描"}</span>
          {model.status?.lastError ? (
            <span className="text-destructive">{model.status.lastError}</span>
          ) : null}
          {model.current ? (
            <>
              <Separator orientation="vertical" className="h-3" />
              <span>当前目录 {formatBytes(model.current.size)}</span>
              <span
                className={cn(
                  model.current.delta > 0 ? "text-destructive" : undefined
                )}
              >
                较上一份快照 {formatSignedBytes(model.current.delta)}
              </span>
            </>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-52 shrink-0 flex-col border-r">
          <div className="px-3 py-2 text-xs font-medium text-muted-foreground">
            快照
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-0.5 px-2 pb-2">
              {model.snapshots.map((snapshot) => (
                <button
                  key={snapshot.id}
                  type="button"
                  onClick={() => model.setScanId(snapshot.id)}
                  className={cn(
                    "flex flex-col items-start rounded-md px-2 py-1.5 text-left text-xs",
                    model.scanId === snapshot.id
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/60"
                  )}
                >
                  <span className="font-medium">
                    {formatTimestamp(snapshot.startedAt)}
                  </span>
                  <span className="text-muted-foreground">
                    合计 {formatBytes(snapshot.totalSize)}
                  </span>
                </button>
              ))}
              {model.snapshots.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  还没有快照，点「立即扫描」生成第一份。
                </p>
              ) : null}
            </div>
          </ScrollArea>
        </aside>

        <div className="min-h-0 flex-1 overflow-hidden">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <SortableHead
                  label="名称"
                  active={sortKey === "name"}
                  descending={descending}
                  onClick={() => toggleSort("name")}
                  className="min-w-56"
                />
                <SortableHead
                  label="大小"
                  active={sortKey === "size"}
                  descending={descending}
                  onClick={() => toggleSort("size")}
                  className="w-24 text-right"
                />
                <SortableHead
                  label="增长"
                  active={sortKey === "delta"}
                  descending={descending}
                  onClick={() => toggleSort("delta")}
                  className="w-24 text-right"
                />
                <TableHead className="w-1/3">路径</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {model.loading && model.entries.length === 0
                ? [0, 1, 2].map((index) => (
                    <TableRow key={index}>
                      <TableCell colSpan={4}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                : rows.map(({ entry, isParent }) => (
                    <TableRow
                      key={isParent ? "__parent__" : entry.path}
                      data-state={selected === entry.path ? "selected" : undefined}
                      className={cn(
                        isParent
                          ? "cursor-pointer"
                          : entry.kind === "dir" && !entry.folded
                            ? "cursor-pointer"
                            : undefined
                      )}
                      onClick={() => {
                        if (isParent) {
                          model.goUp()
                          return
                        }
                        setSelected(entry.path)
                        if (entry.kind === "dir" && !entry.folded) {
                          model.enterDirectory(entry)
                        }
                      }}
                      onDoubleClick={() => {
                        if (isParent) {
                          model.goUp()
                          return
                        }
                        if (entry.kind === "dir" && !entry.folded) {
                          model.enterDirectory(entry)
                        }
                      }}
                    >
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <HugeiconsIcon
                            icon={entry.kind === "dir" ? Folder01Icon : File01Icon}
                            className="size-3.5 text-muted-foreground"
                          />
                          <span className="truncate">{entry.name}</span>
                          {entry.folded ? (
                            <Badge variant="secondary">已折叠</Badge>
                          ) : null}
                          {!isParent && entry.kind === "dir" && !entry.folded ? (
                            <HugeiconsIcon
                              icon={ArrowRight01Icon}
                              className="size-3 text-muted-foreground"
                            />
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {isParent ? "—" : formatBytes(entry.size)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          entry.delta > 0 ? "text-destructive" : "text-muted-foreground"
                        )}
                      >
                        {isParent ? "—" : formatSignedBytes(entry.delta)}
                      </TableCell>
                      <TableCell className="truncate text-xs text-muted-foreground">
                        {entry.path === "" ? "/" : entry.path}
                      </TableCell>
                    </TableRow>
                  ))}
              {!model.loading && sortedEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    {model.keyword.trim().length > 0
                      ? "没有匹配的路径"
                      : "该目录没有记录"}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}

type SortableHeadProps = {
  label: string
  active: boolean
  descending: boolean
  onClick: () => void
  className?: string
}

const SortableHead = (props: SortableHeadProps) => {
  const { label, active, descending, onClick, className } = props
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          active ? "text-foreground" : undefined
        )}
      >
        {label}
        {active ? <span className="text-xs">{descending ? "↓" : "↑"}</span> : null}
      </button>
    </TableHead>
  )
}
