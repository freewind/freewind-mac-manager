import type { ClashVergeProxy } from "@shared/api-contract"
import {
  Card,
  CardContent,
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
 * 代理组分区：默认只显示组名、类型、当前节点与摘要（成员数/存活数），
 * 完整成员列表按需展开；成员区不单独加滚动，随标签主体滚动。
 */
export const ProxyGroups = ({ proxies, sampledAt }: ProxyGroupsProps) => {
  const groups = proxies.filter((proxy) => proxy.members.length > 0)
  return (
    <section className="space-y-3" aria-label="代理组">
      <div>
        <h2 className="text-sm font-medium">代理组与节点</h2>
        <p className="text-xs text-muted-foreground">
          {sampledAt
            ? `采集于 ${new Date(sampledAt).toLocaleTimeString()}`
            : "尚无成功采集"}
          {" · "}仅显示内核已有的延迟记录，不主动测速
        </p>
      </div>
      {groups.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          没有可显示的代理组
        </p>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {groups.map((group) => (
            <Card key={group.name} className="min-w-0 gap-2">
              <CardHeader className="px-4">
                <CardTitle className="break-words text-sm">
                  {group.name}
                </CardTitle>
                <p className="break-all text-xs text-muted-foreground">
                  {group.type}
                  {group.selected
                    ? ` · 当前节点：${group.selected}`
                    : " · 无当前选择信息"}
                  {` · 共 ${group.members.length} 个节点`}
                </p>
              </CardHeader>
              <Collapsible>
                <CollapsibleTrigger
                  render={
                    <button
                      type="button"
                      className="min-h-11 px-4 text-xs text-primary underline-offset-4 hover:underline"
                    >
                      展开全部节点
                    </button>
                  }
                />
                <CollapsibleContent>
                  <CardContent className="flex flex-wrap gap-2">
                    {group.members.map((member) => (
                      <span
                        key={member}
                        className="max-w-full break-all rounded-md border px-3 py-2 text-xs"
                      >
                        {member}
                        {group.selected === member ? " · 当前" : ""}
                      </span>
                    ))}
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          ))}
        </div>
      )}
    </section>
  )
}
