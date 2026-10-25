import { describeError, formatTimestamp } from "@shared/format"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@web/components/ui/collapsible"
import { Table, TableBody, TableCell, TableRow } from "@web/components/ui/table"
import { Copy } from "lucide-react"
import { toast } from "sonner"
import { useClashVergeProfilesQuery } from "./queries"

/** 节点的服务器地址与端口：端口缺失时只显示地址，避免出现 `host:null`。 */
const endpointOf = (server: string, port: number | null): string => {
  if (server === "") return "地址未知"
  return port === null ? server : `${server}:${port}`
}

/**
 * 订阅链接面板（只读）。
 *
 * Clash Verge 不对外提供订阅 API，内容只能解析 profiles.yaml 与各订阅的
 * 配置文件：这里回显的是磁盘上的配置，不是内核运行状态，所以标出文件路径
 * 与读取时间。链接含订阅 token，页面本身有访问密码，故原样显示并支持一键
 * 复制，不做打码。节点信息默认收起，按需展开（订阅动辄上百节点）。
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
        <h2 className="text-sm font-medium">订阅清单</h2>
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
                  className="space-y-2 rounded-lg border p-3"
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
                  <Collapsible>
                    {/* 节点数常驻显示在按钮右侧，不随展开/收缩变化。 */}
                    <div className="flex flex-wrap items-baseline gap-2">
                      <CollapsibleTrigger
                        render={
                          <button
                            type="button"
                            className="text-xs text-primary underline-offset-4 hover:underline"
                          >
                            节点信息
                          </button>
                        }
                      />
                      <span className="text-xs text-muted-foreground">
                        {`共 ${profile.nodes.length} 个节点`}
                        {profile.nodesTruncated ? "（已截断）" : ""}
                      </span>
                    </div>
                    <CollapsibleContent>
                      {profile.nodes.length === 0 ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          没读到节点：该订阅的配置文件可能还没下载
                        </p>
                      ) : (
                        <div className="mt-1 max-h-72 overflow-auto pr-1">
                          {/* 自动布局：前两列按内容宽度（节点名超过一半时截断，
                                留出地址列），最后一列 w-full 吃满剩余宽度并单行截断。 */}
                          <Table>
                            <TableBody>
                              {profile.nodes.map((node) => (
                                <TableRow key={`${node.name}-${node.server}`}>
                                  <TableCell className="max-w-[50%] truncate px-2 py-1 text-left">
                                    {node.name}
                                  </TableCell>
                                  <TableCell className="px-2 py-1 text-left text-muted-foreground">
                                    {node.type}
                                  </TableCell>
                                  <TableCell className="w-full max-w-0 truncate px-2 py-1 text-left text-muted-foreground">
                                    {endpointOf(node.server, node.port)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  )
}
