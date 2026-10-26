import type { ClashVergeProxy } from "@shared/api-contract"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@web/components/ui/collapsible"

type ProxyGroupsProps = {
  proxies: ClashVergeProxy[]
  sampledAt: number | undefined
}

/**
 * 代理组：默认只显示组名、类型、当前节点与摘要（成员数/存活数），
 * 完整成员列表按需展开；成员区不单独加滚动，随页面主体滚动。
 * 整块是一张卡片，放进状态页当作一块内容。
 */
export const ProxyGroups = ({ proxies, sampledAt }: ProxyGroupsProps) => {
  const groups = proxies.filter((proxy) => proxy.members.length > 0)
  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle>代理组与节点</CardTitle>
        <CardDescription>
          {sampledAt
            ? `采集于 ${new Date(sampledAt).toLocaleTimeString()}`
            : "尚无成功采集"}
          {" · "}仅显示内核已有的延迟记录，不主动测速
        </CardDescription>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">没有可显示的代理组</p>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {groups.map((group) => (
              <div
                key={group.name}
                className="min-w-0 space-y-1 rounded-lg border p-3"
              >
                <p className="break-words text-sm font-medium">{group.name}</p>
                <p className="break-all text-xs text-muted-foreground">
                  {group.type}
                  {group.selected
                    ? ` · 当前节点：${group.selected}`
                    : " · 无当前选择信息"}
                  {` · 共 ${group.members.length} 个节点`}
                </p>
                <Collapsible>
                  <CollapsibleTrigger
                    render={
                      <button
                        type="button"
                        className="text-xs text-primary underline-offset-4 hover:underline"
                      >
                        展开全部节点
                      </button>
                    }
                  />
                  <CollapsibleContent className="flex flex-wrap gap-2 pt-2">
                    {group.members.map((member) => (
                      <span
                        key={member}
                        className="max-w-full break-all rounded-md border px-3 py-2 text-xs"
                      >
                        {member}
                        {group.selected === member ? " · 当前" : ""}
                      </span>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
