import type { ClashVergeProfile } from "@shared/api-contract"
import { describeError, formatTimestamp } from "@shared/format"
import { ActionButton } from "@web/components/ActionButton"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@web/components/ui/alert-dialog"
import { Button } from "@web/components/ui/button"
import { Checkbox } from "@web/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@web/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import { useDialogSubmit } from "@web/hooks/use-dialog-submit"
import { ChevronRight, CircleCheck, Copy } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import {
  useClashVergeProfilesQuery,
  useSetClashVergeCurrentProfile,
} from "./queries"

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
  const switchProfile = useSetClashVergeCurrentProfile()
  /** 待确认切换的订阅：非空时弹出确认框。 */
  const [pending, setPending] = useState<ClashVergeProfile | null>(null)
  const confirm = useDialogSubmit(
    () => setPending(null),
    switchProfile.isPending
  )

  const runSwitch = async (): Promise<boolean> => {
    if (!pending) return false
    try {
      const result = await switchProfile.mutateAsync(pending.uid)
      toast.success(result.message)
      return true
    } catch (error) {
      toast.error(describeError(error))
      return false
    }
  }

  /** 合并弹窗的来源订阅：非空即打开，打开时默认勾选它自己。 */
  const [mergeFrom, setMergeFrom] = useState<ClashVergeProfile | null>(null)
  const [mergeUids, setMergeUids] = useState<string[]>([])

  const openMerge = (profile: ClashVergeProfile) => {
    setMergeUids([profile.uid])
    setMergeFrom(profile)
  }

  const toggleMergeUid = (uid: string, checked: boolean) => {
    setMergeUids((current) =>
      checked
        ? [...new Set([...current, uid])]
        : current.filter((item) => item !== uid)
    )
  }

  const confirmMerge = () => {
    const count = mergeUids.length
    setMergeFrom(null)
    toast.success(`已选择 ${count} 个订阅用于合并`)
  }

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
                    <span className="flex min-w-0 flex-1 items-center gap-1">
                      <span className="min-w-0 truncate text-sm font-medium">
                        {profile.name}
                      </span>
                      {profile.current ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-600/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                          <CircleCheck aria-hidden="true" className="size-3" />
                          当前启用
                        </span>
                      ) : null}
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
                    {profile.current ? null : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={confirm.busy}
                        onClick={() => setPending(profile)}
                      >
                        使用当前
                      </Button>
                    )}
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
                            className="flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline [&[aria-expanded=true]>svg]:rotate-90"
                          >
                            <ChevronRight
                              aria-hidden="true"
                              className="size-3 transition-transform"
                            />
                            节点信息
                          </button>
                        }
                      />
                      <span className="text-xs text-muted-foreground">
                        {`共 ${profile.nodes.length} 个节点`}
                        {profile.nodesTruncated ? "（已截断）" : ""}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openMerge(profile)}
                      >
                        合并订阅
                      </Button>
                    </div>
                    <CollapsibleContent>
                      {profile.nodes.length === 0 ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          没读到节点：该订阅的配置文件可能还没下载
                        </p>
                      ) : (
                        <div className="mt-1 max-h-72 overflow-auto pr-1">
                          {/* 自动布局：前四列按内容宽度（节点名超过一半时截断，
                              留出地址列），最后一列 w-full 吃满剩余宽度并单行截断。 */}
                          <Table>
                            <TableBody>
                              {profile.nodes.map((node, index) => (
                                <TableRow key={`${node.name}-${node.server}`}>
                                  <TableCell className="px-2 py-1 text-left text-muted-foreground">
                                    {index + 1}
                                  </TableCell>
                                  <TableCell className="max-w-[50%] truncate px-2 py-1 text-left">
                                    {node.name}
                                  </TableCell>
                                  <TableCell className="px-2 py-1 text-left text-muted-foreground">
                                    {node.duplicateOf === null
                                      ? ""
                                      : `重复(${node.duplicateOf})`}
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

      <Dialog
        open={mergeFrom !== null}
        onOpenChange={(open) => {
          if (!open) setMergeFrom(null)
        }}
      >
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>合并订阅</DialogTitle>
            <DialogDescription>勾选要参与合并的订阅。</DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>订阅</TableHead>
                <TableHead className="text-right">节点数</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.profiles ?? []).map((profile) => (
                <TableRow key={profile.uid || profile.url}>
                  <TableCell className="w-8 py-1">
                    <Checkbox
                      aria-label={`选择订阅：${profile.name}`}
                      checked={mergeUids.includes(profile.uid)}
                      onCheckedChange={(checked) =>
                        toggleMergeUid(profile.uid, checked)
                      }
                    />
                  </TableCell>
                  <TableCell className="max-w-0 truncate py-1">
                    {profile.name}
                  </TableCell>
                  <TableCell className="py-1 text-right text-muted-foreground tabular-nums">
                    {profile.nodes.length}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeFrom(null)}>
              取消
            </Button>
            <Button disabled={mergeUids.length === 0} onClick={confirmMerge}>
              合并订阅
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !confirm.busy) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {`切换到「${pending?.name ?? ""}」？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              会改写 Clash Verge 订阅清单里的当前订阅并重启
              App。重启期间系统代理与 TUN
              短暂中断（数秒）：如果正通过这个代理远程访问本页，连接会断开。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirm.busy}>取消</AlertDialogCancel>
            <ActionButton
              busy={confirm.busy}
              busyLabel="切换中…"
              onClick={() => void confirm.submit(runSwitch)}
            >
              确认切换
            </ActionButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
