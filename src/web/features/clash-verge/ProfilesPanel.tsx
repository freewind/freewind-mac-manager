import { describeError, formatTimestamp } from "@shared/format"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import { Copy } from "lucide-react"
import { toast } from "sonner"
import { useClashVergeProfilesQuery } from "./queries"

/**
 * 订阅链接面板（只读）。
 *
 * Clash Verge 不对外提供订阅 API，内容只能解析 profiles.yaml：这里回显的是
 * 磁盘上的配置，不是内核运行状态，所以标出文件路径与读取时间。链接含订阅
 * token，页面本身有访问密码，故原样显示并提供一键复制，不做打码。
 */
export const ProfilesPanel = () => {
  const query = useClashVergeProfilesQuery()
  const data = query.data

  const copyUrl = async (url: string, name: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success(`已复制订阅链接：${name}`)
    } catch {
      toast.error("复制失败：浏览器拒绝了剪贴板访问")
    }
  }

  return (
    <section className="space-y-3" aria-label="订阅链接">
      <div>
        <h2 className="text-sm font-medium">订阅链接</h2>
        <p className="text-xs text-muted-foreground">
          只读：内容来自 Clash Verge 订阅清单文件，不是内核运行状态
        </p>
      </div>

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">正在读取订阅清单…</p>
      ) : null}

      {query.isError ? (
        <Alert variant="destructive">
          <AlertTitle>读取订阅清单失败</AlertTitle>
          <AlertDescription>{describeError(query.error)}</AlertDescription>
        </Alert>
      ) : null}

      {data !== undefined ? (
        <>
          <p className="text-xs break-all text-muted-foreground">
            {`${data.path} · 读取于 ${formatTimestamp(data.sampledAt)}`}
          </p>
          {data.profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              未发现订阅：清单里没有 remote 条目
            </p>
          ) : (
            <ul className="space-y-3">
              {data.profiles.map((profile) => (
                <li
                  key={profile.uid || profile.url}
                  className="space-y-1 rounded-lg border p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {profile.name}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`复制订阅链接：${profile.name}`}
                      onClick={() => void copyUrl(profile.url, profile.name)}
                    >
                      <Copy aria-hidden="true" />
                      复制
                    </Button>
                  </div>
                  <p className="font-mono text-xs break-all text-muted-foreground">
                    {profile.url}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  )
}
