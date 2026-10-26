import type {
  ClashVergeProxiesResponse,
  ClashVergeProxy,
} from "@shared/api-contract"
import { SortableTableHead } from "@web/components/SortableTableHead"
import { Button } from "@web/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import { useTableSort } from "@web/hooks/use-table-sort"
import { Fragment, useState } from "react"

type ProxyGroupsProps = {
  proxies: ClashVergeProxiesResponse | undefined
  isError: boolean
}

/** 只有一个成员的组（比如只剩直连）也算组，但空组不显示。 */
const groupsOf = (proxies: ClashVergeProxiesResponse | undefined) =>
  (proxies?.proxies ?? []).filter((proxy) => proxy.members.length > 0)

type GroupSortKey = "name" | "members"

const GROUP_SORT_COLUMNS: Record<
  GroupSortKey,
  (group: ClashVergeProxy) => number | string
> = {
  name: (group) => group.name,
  members: (group) => group.members.length,
}

/**
 * 代理组：一行一组，显示类型、当前选中与成员数，需要时展开节点标签。
 *
 * 之前「分组选择」表与「代理组与节点」两块渲染的是同一份数据，
 * 现在合成一张表：概览看表格，节点按需展开，不再占十几屏。
 */
export const ProxyGroups = ({ proxies, isError }: ProxyGroupsProps) => {
  const { items: groups, sort } = useTableSort<GroupSortKey, ClashVergeProxy>({
    items: groupsOf(proxies),
    columns: GROUP_SORT_COLUMNS,
    initialKey: "name",
    descendingOnSwitch: () => false,
  })
  const [openNames, setOpenNames] = useState<readonly string[]>([])

  const toggle = (name: string) => {
    setOpenNames((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name]
    )
  }

  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle>代理组</CardTitle>
        <CardDescription>
          {proxies?.sampledAt
            ? `采集于 ${new Date(proxies.sampledAt).toLocaleTimeString()}`
            : "尚无成功采集"}
          {" · "}仅显示内核已有的延迟记录，不主动测速
        </CardDescription>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {isError
              ? "读取代理组失败"
              : proxies === undefined
                ? "正在读取代理组…"
                : "内核里还没有代理组"}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead
                  sort={sort}
                  column="name"
                  label="组名"
                  className="min-w-[100px]"
                />
                <TableHead className="min-w-[80px]">类型</TableHead>
                <TableHead className="min-w-[160px]">当前选中</TableHead>
                <SortableTableHead
                  sort={sort}
                  column="members"
                  label="成员数"
                  className="min-w-[60px]"
                />
                <TableHead className="w-full min-w-[80px]">
                  <span className="sr-only">节点</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => {
                const open = openNames.includes(group.name)
                return (
                  <Fragment key={group.name}>
                    <TableRow>
                      <TableCell className="max-w-0 truncate text-left">
                        {group.name}
                      </TableCell>
                      <TableCell className="text-left text-muted-foreground">
                        {group.type}
                      </TableCell>
                      <TableCell className="max-w-0 truncate text-left">
                        {group.selected ?? "未选择"}
                      </TableCell>
                      <TableCell className="text-left tabular-nums text-muted-foreground">
                        {group.members.length}
                      </TableCell>
                      <TableCell className="w-full text-left">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-expanded={open}
                          aria-label={`${open ? "收起" : "展开"}「${group.name}」的节点`}
                          onClick={() => toggle(group.name)}
                        >
                          {open ? "收起节点" : "展开节点"}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {open ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="bg-muted/30 whitespace-normal"
                        >
                          <div className="flex flex-wrap gap-2">
                            {group.members.map((member) => (
                              <span
                                key={member}
                                className="max-w-full break-all rounded-md border px-2 py-1 text-xs"
                              >
                                {member}
                                {group.selected === member ? " · 当前" : ""}
                              </span>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
