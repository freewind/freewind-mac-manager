import { File } from "@pierre/diffs/react"
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@web/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog"
import { Table, TableBody, TableCell, TableRow } from "@web/components/ui/table"
import { useDialogSubmit } from "@web/hooks/use-dialog-submit"
import { useThemeType } from "@web/hooks/use-theme-type"
import {
  ChevronRight,
  CircleCheck,
  Copy,
  FileCode,
  LoaderCircle,
} from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"
import {
  useClashVergeProfileFileQuery,
  useClashVergeProfilesQuery,
  useSetClashVergeCurrentProfile,
} from "./queries"

/** 节点的服务器地址与端口：端口缺失时只显示地址，避免出现 `host:null`。 */
const endpointOf = (server: string, port: number | null): string => {
  if (server === "") return "地址未知"
  return port === null ? server : `${server}:${port}`
}

/** 节点表格：规则列宽统一，最后一列占满剩余。 */
const NodeTable = (props: { nodes: ClashVergeProfile["nodes"] }) => (
  <Table>
    <TableBody>
      {props.nodes.map((node, index) => (
        <TableRow key={`${node.name}-${node.server}`}>
          <TableCell className="min-w-[60px] px-2 py-1 text-left text-muted-foreground">
            {index + 1}
          </TableCell>
          <TableCell className="min-w-[60px] px-2 py-1 text-left">
            {node.name}
          </TableCell>
          <TableCell className="min-w-[60px] px-2 py-1 text-left text-muted-foreground">
            {node.duplicateOf === null ? "" : `重复(${node.duplicateOf})`}
          </TableCell>
          <TableCell className="min-w-[60px] px-2 py-1 text-left text-muted-foreground">
            {node.type}
          </TableCell>
          <TableCell className="w-full min-w-[60px] max-w-0 truncate px-2 py-1 text-left text-muted-foreground">
            {endpointOf(node.server, node.port)}
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
)

/** 小到这种程度就直接上高亮，不必先闪一下纯文本。 */
const FILE_HIGHLIGHT_EAGER_MAX_CHARS = 20_000

/**
 * 高亮是同步渲染的，成本随字符数增长；haitta 那种 88 万字符的配置要算很久。
 * 超过这个长度不自动加高亮，先给纯文本，需要时手动点。
 */
const FILE_HIGHLIGHT_AUTO_MAX_CHARS = 200_000

/**
 * 配置文件正文：先出纯文本，再补 YAML 高亮。
 *
 * 高亮是同步计算，一挂上就占住主线程，所以不在首帧直接渲染：先用 pre 把原文
 * 提交到页面（ref 回调在提交后运行），再推后 150ms 切到高亮。超大文件不自动切换，
 * 改成手动点。
 */
const ProfileFileBody = (props: {
  content: string
  fileName: string
  themeType: ReturnType<typeof useThemeType>
}) => {
  const autoHighlight = props.content.length <= FILE_HIGHLIGHT_AUTO_MAX_CHARS
  const [highlight, setHighlight] = useState(
    props.content.length <= FILE_HIGHLIGHT_EAGER_MAX_CHARS
  )
  const scheduled = useRef(false)
  // 原文一上屏就排一次切换；ref 回调可能重复触发，用 ref 挡住。
  const scheduleHighlight = (node: HTMLPreElement | null) => {
    if (node === null || scheduled.current || !autoHighlight) return
    scheduled.current = true
    setTimeout(() => setHighlight(true), 150)
  }
  if (!highlight) {
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <LoaderCircle
              className="size-3 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            {autoHighlight
              ? "正在添加语法高亮…"
              : `文件较大（${props.content.length} 字符），先按纯文本显示`}
          </p>
          {autoHighlight ? null : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHighlight(true)}
            >
              添加高亮
            </Button>
          )}
        </div>
        <pre
          ref={scheduleHighlight}
          className="max-h-[70vh] overflow-auto rounded-md border p-2 text-xs"
        >
          {props.content}
        </pre>
      </div>
    )
  }
  return (
    <div className="max-h-[70vh] overflow-auto rounded-md border text-xs">
      <File
        key={props.themeType}
        file={{ name: props.fileName, contents: props.content }}
        options={{
          theme: { dark: "github-dark", light: "github-light" },
          themeType: props.themeType,
          disableFileHeader: true,
        }}
      />
    </div>
  )
}

const ProfileFileDialog = (props: {
  profile: ClashVergeProfile | null
  onClose: () => void
}) => {
  const query = useClashVergeProfileFileQuery(props.profile?.uid ?? null)
  const themeType = useThemeType()
  return (
    <Dialog
      open={props.profile !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <DialogContent className="w-[min(96vw,1100px)] sm:max-w-[1100px]">
        <DialogHeader>
          <DialogTitle>{props.profile?.name ?? ""}</DialogTitle>
          <DialogDescription className="break-all">
            {query.data === undefined
              ? "正在读取配置文件"
              : `${query.data.path} · ${query.data.size} 字节${query.data.truncated ? "（超出上限，只显示前 200 万字符）" : ""}`}
          </DialogDescription>
        </DialogHeader>
        {query.isError ? (
          <Alert variant="destructive">
            <AlertTitle>读取配置文件失败</AlertTitle>
            <AlertDescription>{describeError(query.error)}</AlertDescription>
          </Alert>
        ) : query.data === undefined ? (
          <p className="text-sm text-muted-foreground">读取中…</p>
        ) : (
          <ProfileFileBody
            key={`${props.profile?.uid ?? ""}:${query.data.content.length}`}
            content={query.data.content}
            fileName={query.data.path.split("/").pop() ?? "profile.yaml"}
            themeType={themeType}
          />
        )}
      </DialogContent>
    </Dialog>
  )
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
  /** 正在看配置文件的订阅：非空时弹出文件弹窗。 */
  const [fileProfile, setFileProfile] = useState<ClashVergeProfile | null>(null)
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
                    {profile.url === null ? null : (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`复制订阅链接：${profile.name}`}
                        onClick={() =>
                          void copyUrl(profile.url ?? "", profile.name)
                        }
                      >
                        <Copy aria-hidden="true" />
                        复制
                      </Button>
                    )}
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
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`查看配置文件：${profile.name}`}
                      onClick={() => setFileProfile(profile)}
                    >
                      <FileCode aria-hidden="true" />
                      文件
                    </Button>
                  </div>
                  <p className="font-mono text-xs break-all text-muted-foreground">
                    {profile.url ?? "（本地配置，没有订阅链接）"}
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
                    </div>
                    <CollapsibleContent>
                      {profile.nodes.length === 0 ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          没读到节点：该订阅的配置文件可能还没下载
                        </p>
                      ) : profile.groups.length === 0 ? (
                        <div className="mt-1 max-h-72 overflow-auto pr-1">
                          <NodeTable nodes={profile.nodes} />
                        </div>
                      ) : (
                        /* 有代理组时展示层级：第一级是组，展开后是该组的节点。 */
                        <div className="mt-2 space-y-2">
                          {profile.groups.map((group) => {
                            const byName = new Map(
                              profile.nodes.map((node) => [node.name, node])
                            )
                            const members = group.members
                              .map((name) => byName.get(name))
                              .filter((node) => node !== undefined)
                            return (
                              <Collapsible key={group.name}>
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
                                      {`${group.name}（${members.length}）`}
                                    </button>
                                  }
                                />
                                <CollapsibleContent>
                                  <div className="mt-1 max-h-72 overflow-auto pr-1">
                                    <NodeTable nodes={members} />
                                  </div>
                                </CollapsibleContent>
                              </Collapsible>
                            )
                          })}
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

      <ProfileFileDialog
        profile={fileProfile}
        onClose={() => setFileProfile(null)}
      />
    </section>
  )
}
