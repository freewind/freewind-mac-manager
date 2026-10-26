import type {
  ClashVergeProfilesResponse,
  ClashVergeProxiesResponse,
  ClashVergeProxy,
} from "@shared/api-contract"
import { MERGED_PRIMARY_GROUP } from "@shared/clash-merge-defaults"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import { Fragment } from "react"

/** 订阅来源：远程订阅只显示域名，本地生成的配置写明是本地文件。 */
const sourceOf = (url: string | null): string => {
  if (url === null) {
    return "本地文件"
  }
  try {
    return new URL(url).host
  } catch {
    return "订阅链接"
  }
}

type Hop = { name: string; isNode: boolean }

/**
 * 出口链的起点：优先用自己配置的主代理组，
 * 换成别人的配置时退到 GLOBAL，再退到任意一个组。
 */
const startGroupOf = (proxies: ClashVergeProxy[]): string | null => {
  const names = new Set(proxies.map((proxy) => proxy.name))
  if (names.has(MERGED_PRIMARY_GROUP)) return MERGED_PRIMARY_GROUP
  if (names.has("GLOBAL")) return "GLOBAL"
  const group = proxies.find((proxy) => proxy.members.length > 0)
  return group?.name ?? null
}

/**
 * 沿「组 → 选中项」往下走，直到落到真实节点。
 * 内核没有「全局当前节点」字段，全局出口就是这么解析出来的；
 * 环和过长的链都靠步数上限兜住。
 */
const exitChainOf = (proxies: ClashVergeProxy[]): Hop[] => {
  const byName = new Map(proxies.map((proxy) => [proxy.name, proxy]))
  const hops: Hop[] = []
  let current = startGroupOf(proxies)
  for (let step = 0; step < 8 && current !== null; step += 1) {
    const proxy = byName.get(current)
    if (proxy === undefined) break
    const isNode = proxy.members.length === 0
    hops.push({ name: proxy.name, isNode })
    if (isNode || !proxy.selected) break
    current = proxy.selected
  }
  return hops
}

/**
 * 当前订阅：profiles.yaml 顶层 current 指向的那一条，
 * 外加它真正在用的出口节点 —— 组名本身不是出口，得往下解析。
 */
export const CurrentProfileCard = (props: {
  profiles: ClashVergeProfilesResponse | undefined
  isError: boolean
  proxies: ClashVergeProxiesResponse | undefined
}) => {
  const current = props.profiles?.profiles.find((item) => item.current)
  const chain = exitChainOf(props.proxies?.proxies ?? [])
  const last = chain.at(-1)

  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle>当前订阅</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {current === undefined ? (
          <p className="text-xs text-muted-foreground">
            {props.isError
              ? "读取订阅清单失败"
              : props.profiles === undefined
                ? "正在读取订阅清单…"
                : "订阅清单里没有标记为当前的条目"}
          </p>
        ) : (
          <>
            <p className="break-words text-base font-medium">{current.name}</p>
            <p className="text-xs break-all text-muted-foreground">
              {`${sourceOf(current.url)} · ${current.nodes.length} 个节点 · ${current.groups.length} 个组`}
              {current.nodesTruncated ? "（节点过多，只列了一部分）" : ""}
            </p>
          </>
        )}
        <div className="space-y-1 pt-2">
          <p className="text-xs text-muted-foreground">当前出口节点</p>
          {chain.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {props.proxies === undefined
                ? "正在读取内核代理组…"
                : "还没读到代理组，无法判断出口"}
            </p>
          ) : (
            <p className="flex flex-wrap items-center gap-1 text-xs">
              {chain.map((hop, index) => (
                <Fragment key={hop.name}>
                  {index > 0 ? (
                    <span className="text-muted-foreground">→</span>
                  ) : null}
                  <span
                    className={
                      hop.isNode
                        ? "max-w-full break-all rounded-md border px-2 py-0.5"
                        : "text-muted-foreground"
                    }
                  >
                    {hop.name}
                  </span>
                </Fragment>
              ))}
              {last && !last.isNode ? (
                <span className="text-muted-foreground">（未选中）</span>
              ) : null}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
