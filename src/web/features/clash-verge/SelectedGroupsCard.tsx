import type {
  ClashVergeProxiesResponse,
  ClashVergeProxy,
} from "@shared/api-contract"
import { SortableTableHead } from "@web/components/SortableTableHead"
import {
  Card,
  CardContent,
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

/** 只剩一个选项的组（比如只有单个节点的直连）不必占一张表。 */
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
 * 代理组概览：一眼看清每个组当前选中哪个节点。
 * 只读内核已有的记录，不主动测速；完整成员在「代理组」标签里展开看。
 */
export const SelectedGroupsCard = (props: {
  proxies: ClashVergeProxiesResponse | undefined
  isError: boolean
}) => {
  const { items: groups, sort } = useTableSort<GroupSortKey, ClashVergeProxy>({
    items: groupsOf(props.proxies),
    columns: GROUP_SORT_COLUMNS,
    initialKey: "name",
    descendingOnSwitch: () => false,
  })

  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle>代理组</CardTitle>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {props.isError
              ? "读取代理组失败"
              : props.proxies === undefined
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
                <TableHead className="min-w-[120px]">当前选中</TableHead>
                <SortableTableHead
                  sort={sort}
                  column="members"
                  label="成员数"
                  className="w-full min-w-[60px]"
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <TableRow key={group.name}>
                  <TableCell className="max-w-0 truncate text-left">
                    {group.name}
                  </TableCell>
                  <TableCell className="text-left text-muted-foreground">
                    {group.type}
                  </TableCell>
                  <TableCell className="max-w-0 truncate text-left">
                    {group.selected ?? "未选择"}
                  </TableCell>
                  <TableCell className="w-full text-left tabular-nums text-muted-foreground">
                    {group.members.length}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
