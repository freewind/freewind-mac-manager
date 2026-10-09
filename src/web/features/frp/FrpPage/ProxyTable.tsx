import { HugeiconsIcon } from "@hugeicons/react"
import {
  Loading03Icon,
  MoreHorizontalIcon,
  PencilEdit01Icon,
  Radar01Icon,
  TrashIcon,
} from "@hugeicons/core-free-icons"
import { formatTimestamp } from "@shared/format"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import type { FrpProxy } from "@shared/api-contract"
import type { FrpPageModel } from "@web/features/frp/useFrp"
import { cn } from "@web/lib/utils"

type ProxyTableProps = {
  model: FrpPageModel
  onEdit: (proxy: FrpProxy) => void
  onDelete: (proxy: FrpProxy) => void
}

/** 隧道列表：查看、选中、探测、编辑、删除。 */
export const ProxyTable = (props: ProxyTableProps) => {
  const { model, onEdit, onDelete } = props

  if (model.visibleProxies.length === 0) {
    return (
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={Radar01Icon} />
          </EmptyMedia>
          <EmptyTitle>没有匹配的隧道</EmptyTitle>
          <EmptyDescription>
            调整搜索或类型筛选，或新增一条隧道。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>隧道名</TableHead>
          <TableHead>类型</TableHead>
          <TableHead>本地目标</TableHead>
          <TableHead>远程端口</TableHead>
          <TableHead>连通性</TableHead>
          <TableHead className="w-10 text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {model.visibleProxies.map((proxy) => {
          const probe = model.probes[proxy.name]
          const checking = model.checking.includes(proxy.name)
          return (
            <TableRow
              key={proxy.name}
              data-state={
                model.selectedName === proxy.name ? "selected" : undefined
              }
              className={cn(
                "cursor-pointer",
                model.selectedName === proxy.name && "bg-accent/60"
              )}
              onClick={() => model.select(proxy.name)}
            >
              <TableCell className="font-medium">{proxy.name}</TableCell>
              <TableCell>
                <Badge variant="outline">{proxy.type}</Badge>
              </TableCell>
              <TableCell className="font-mono text-xs">
                {proxy.localIP}:{proxy.localPort}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {proxy.remotePort}
              </TableCell>
              <TableCell>
                {checking ? (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <HugeiconsIcon
                      icon={Loading03Icon}
                      className="size-3.5 animate-spin"
                    />
                    探测中
                  </span>
                ) : probe ? (
                  <span className="flex items-center gap-1.5">
                    <Badge
                      className={
                        probe.reachable
                          ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400"
                          : undefined
                      }
                      variant={probe.reachable ? "secondary" : "destructive"}
                      title={probe.message}
                    >
                      {probe.reachable ? "可达" : "不可达"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {probe.reachable
                        ? `${probe.latencyMs}ms · ${formatTimestamp(probe.checkedAt)}`
                        : formatTimestamp(probe.checkedAt)}
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">未探测</span>
                )}
              </TableCell>
              <TableCell
                className="text-right"
                onClick={(event) => event.stopPropagation()}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${proxy.name} 的操作`}
                      >
                        <HugeiconsIcon icon={MoreHorizontalIcon} />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEdit(proxy)}>
                      <HugeiconsIcon icon={PencilEdit01Icon} />
                      编辑
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => model.probe(proxy)}>
                      <HugeiconsIcon icon={Radar01Icon} />
                      探测连通
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => onDelete(proxy)}
                    >
                      <HugeiconsIcon icon={TrashIcon} />
                      删除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
