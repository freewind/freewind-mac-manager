import { HugeiconsIcon } from "@hugeicons/react"
import {
  Cancel01Icon,
  Copy01Icon,
  Delete02Icon,
  EyeIcon,
  MoreHorizontalIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { formatBytes, describeError } from "@shared/format"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import { Checkbox } from "@web/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@web/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@web/components/ui/empty"
import { Progress } from "@web/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import { cn } from "@web/lib/utils"
import {
  formatDuration,
  PROCESS_KIND_LABEL,
  PROCESS_STATE_LABEL,
  PROCESS_STATE_VARIANT,
  toPercent,
} from "@web/features/processes/display"
import type { ProcessEntry } from "@shared/api-contract"
import { ProcessAvatar } from "@web/features/processes/ProcessesPage/ProcessAvatar"
import type { useProcesses } from "@web/features/processes/useProcesses"

const COLUMN_COUNT = 11

/** 表格列的排序键；只影响本表格，所以放在组件自己的 state 里。 */
type SortKey = "name" | "pid" | "cpu" | "memory" | "threads" | "started"

const compareRows = (
  left: ProcessEntry,
  right: ProcessEntry,
  sortKey: SortKey
): number => {
  switch (sortKey) {
    case "name":
      return left.name.localeCompare(right.name)
    case "memory":
      return left.memoryBytes - right.memoryBytes
    case "threads":
      return (left.threads ?? 0) - (right.threads ?? 0)
    case "pid":
      return left.pid - right.pid
    case "started":
      return left.startedAt - right.startedAt
    case "cpu":
      return left.cpu - right.cpu
  }
}

type ProcessTableProps = {
  model: ReturnType<typeof useProcesses>
  onRequestTerminate: (items: ProcessEntry[], force: boolean) => void
}

export const ProcessTable = (props: ProcessTableProps) => {
  const { model, onRequestTerminate } = props
  const [sortKey, setSortKey] = useState<SortKey>("cpu")
  const [descending, setDescending] = useState(true)

  const rows = useMemo(() => {
    const sorted = [...model.filteredProcesses].sort((left, right) =>
      compareRows(left, right, sortKey)
    )
    return descending ? sorted.reverse() : sorted
  }, [model.filteredProcesses, sortKey, descending])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setDescending((value) => !value)
      return
    }
    setSortKey(key)
    setDescending(key !== "name")
  }

  const allChecked =
    rows.length > 0 && rows.every((item) => model.checkedPids.includes(item.pid))

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead className="w-8">
              <Checkbox
                checked={allChecked}
                onCheckedChange={(checked: boolean) =>
                  model.setChecked(
                    checked ? rows.map((item) => item.pid) : []
                  )
                }
                aria-label="全选"
              />
            </TableHead>
            <SortableHead
              label="进程名称"
              active={sortKey === "name"}
              descending={descending}
              onClick={() => toggleSort("name")}
              className="min-w-64"
            />
            <SortableHead
              label="PID"
              active={sortKey === "pid"}
              descending={descending}
              onClick={() => toggleSort("pid")}
              className="w-16"
            />
            <TableHead className="w-20">用户</TableHead>
            <TableHead className="w-20">状态</TableHead>
            <SortableHead
              label="CPU"
              active={sortKey === "cpu"}
              descending={descending}
              onClick={() => toggleSort("cpu")}
              className="w-28"
            />
            <SortableHead
              label="内存"
              active={sortKey === "memory"}
              descending={descending}
              onClick={() => toggleSort("memory")}
              className="w-36"
            />
            <SortableHead
              label="线程"
              active={sortKey === "threads"}
              descending={descending}
              onClick={() => toggleSort("threads")}
              className="w-14"
            />
            <TableHead className="w-32">端口</TableHead>
            <SortableHead
              label="运行时长"
              active={sortKey === "started"}
              descending={descending}
              onClick={() => toggleSort("started")}
              className="w-24"
            />
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((item) => (
            <ProcessRow
              key={item.pid}
              item={item}
              currentUser={model.currentUser}
              checked={model.checkedPids.includes(item.pid)}
              memoryRatio={item.memoryBytes / model.peakMemoryBytes}
              uptimeSeconds={model.nowMs / 1000 - item.startedAt}
              onCheck={model.toggleChecked}
              onOpen={() => model.selectProcess(item.pid)}
              onRequestTerminate={onRequestTerminate}
            />
          ))}
          {rows.length === 0 && !model.isLoading ? (
            <TableRow>
              <TableCell colSpan={COLUMN_COUNT} className="p-0">
                <Empty className="py-10">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <HugeiconsIcon icon={Search01Icon} />
                    </EmptyMedia>
                    <EmptyTitle>没有匹配的进程</EmptyTitle>
                    <EmptyDescription>
                      换个关键词，或切换到别的筛选范围
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  )
}

type ProcessRowProps = {
  item: ProcessEntry
  currentUser: string
  checked: boolean
  memoryRatio: number
  uptimeSeconds: number
  onCheck: (pid: number, checked: boolean) => void
  onOpen: () => void
  onRequestTerminate: (items: ProcessEntry[], force: boolean) => void
}

const ProcessRow = (props: ProcessRowProps) => {
  const {
    item,
    currentUser,
    checked,
    memoryRatio,
    uptimeSeconds,
    onCheck,
    onOpen,
    onRequestTerminate,
  } = props
  const hot = item.cpu >= 20

  const copyPid = async () => {
    try {
      await navigator.clipboard.writeText(String(item.pid))
      toast.success(`已复制 PID ${item.pid}`)
    } catch (error) {
      toast.error(describeError(error))
    }
  }

  return (
    <TableRow
      className="cursor-pointer"
      data-state={checked ? "selected" : undefined}
      onClick={onOpen}
    >
      <TableCell onClick={(event) => event.stopPropagation()}>
        <Checkbox
          checked={checked}
          onCheckedChange={(next: boolean) => onCheck(item.pid, next)}
          aria-label={`选择 ${item.name}`}
        />
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-2">
          <ProcessAvatar name={item.name} />
          <span className="min-w-0 truncate">{item.name}</span>
          {item.user !== currentUser ? (
            <Badge variant="outline" className="shrink-0">
              系统
            </Badge>
          ) : null}
          {item.kind === "helper" ? (
            <Badge variant="ghost" className="shrink-0">
              {PROCESS_KIND_LABEL[item.kind]}
            </Badge>
          ) : null}
        </span>
      </TableCell>
      <TableCell className="tabular-nums text-muted-foreground">
        {item.pid}
      </TableCell>
      <TableCell className="truncate text-muted-foreground">
        {item.user}
      </TableCell>
      <TableCell>
        <Badge variant={PROCESS_STATE_VARIANT[item.state]}>
          {PROCESS_STATE_LABEL[item.state]}
        </Badge>
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "w-11 text-right tabular-nums",
              hot ? "text-destructive" : undefined
            )}
          >
            {item.cpu.toFixed(1)}%
          </span>
          <Progress value={toPercent(item.cpu / 100)} className="w-14" />
        </span>
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-2">
          <span className="w-16 text-right tabular-nums">
            {formatBytes(item.memoryBytes)}
          </span>
          <Progress value={toPercent(memoryRatio)} className="w-14" />
        </span>
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {item.threads}
      </TableCell>
      <TableCell>
        {item.ports.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {item.ports.map((port) => (
              <Badge key={port} variant="outline">
                :{port}
              </Badge>
            ))}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {formatDuration(uptimeSeconds)}
      </TableCell>
      <TableCell onClick={(event) => event.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-xs" aria-label="更多操作">
                <HugeiconsIcon icon={MoreHorizontalIcon} />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onOpen}>
              <HugeiconsIcon icon={EyeIcon} />
              查看详情
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void copyPid()}>
              <HugeiconsIcon icon={Copy01Icon} />
              复制 PID
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onRequestTerminate([item], false)}>
              <HugeiconsIcon icon={Cancel01Icon} />
              结束进程
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onRequestTerminate([item], true)}
            >
              <HugeiconsIcon icon={Delete02Icon} />
              强制结束
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
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
      <Button
        variant="ghost"
        size="xs"
        onClick={onClick}
        className={cn("-ml-2", active ? "text-foreground" : "text-muted-foreground")}
      >
        {label}
        {active ? <span>{descending ? "↓" : "↑"}</span> : null}
      </Button>
    </TableHead>
  )
}
