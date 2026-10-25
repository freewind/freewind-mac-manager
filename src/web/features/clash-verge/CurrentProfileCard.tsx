import type { ClashVergeProfilesResponse } from "@shared/api-contract"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"

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

/**
 * 当前订阅：profiles.yaml 顶层 current 指向的那一条。
 * 只看「现在生效的是哪份配置」，完整清单在「订阅信息」标签。
 */
export const CurrentProfileCard = (props: {
  profiles: ClashVergeProfilesResponse | undefined
  isError: boolean
}) => {
  const current = props.profiles?.profiles.find((item) => item.current)

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
      </CardContent>
    </Card>
  )
}
