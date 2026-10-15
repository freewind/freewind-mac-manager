import type { McpServer } from "@shared/api-contract"
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
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import { Separator } from "@web/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@web/components/ui/toggle-group"
import { useDialogSubmit } from "@web/hooks/use-dialog-submit"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { ArrowLeft, Copy, Pencil, Plug, PlugZap, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { CallRecords } from "./CallRecords"
import {
  CONNECTION_LABELS,
  CONNECTION_VARIANTS,
  formatDateTime,
  formatRelative,
  prettyJson,
  transportLabel,
} from "./format"
import { PromptsPanel } from "./PromptsPanel"
import { ResourcesPanel } from "./ResourcesPanel"
import { ServerLogs } from "./ServerLogs"
import { ToolsPanel } from "./ToolsPanel"
import { MCP_TABS, type McpTab } from "./useMcpSelection"

/** 把服务器配置还原成常见客户端的 JSON 形状，便于复制到别处。 */
const configJson = (server: McpServer): string => {
  const spec: Record<string, unknown> =
    server.config.transport === "stdio"
      ? {
          command: server.config.command,
          args: server.config.args,
          ...(server.config.cwd ? { cwd: server.config.cwd } : {}),
          ...(server.config.env.length > 0
            ? {
                env: Object.fromEntries(
                  server.config.env.map((item) => [item.key, item.value])
                ),
              }
            : {}),
        }
      : {
          url: server.config.url,
          ...(server.config.headers.length > 0
            ? {
                headers: Object.fromEntries(
                  server.config.headers.map((item) => [item.key, item.value])
                ),
              }
            : {}),
        }
  return prettyJson({ mcpServers: { [server.config.name]: spec } })
}

const copyText = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text)
    toast.success("已复制配置 JSON")
  } catch {
    toast.error("复制失败：当前环境不允许访问剪贴板")
  }
}

/** 本机命令与远程地址的只读摘要：连接前要能看清「即将执行什么」。 */
const ConfigSummary = (props: { server: McpServer }) => {
  const { config } = props.server
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">配置</span>
        <span className="text-xs text-muted-foreground">
          {transportLabel(config.transport)}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto shrink-0 px-3"
          onClick={() => void copyText(configJson(props.server))}
        >
          <Copy aria-hidden="true" />
          复制 JSON
        </Button>
      </div>
      {config.transport === "stdio" ? (
        <pre className="max-w-full overflow-x-auto rounded-md border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap break-words">
          {[config.command, ...config.args].join(" ")}
          {config.cwd ? `\n\n工作目录：${config.cwd}` : ""}
        </pre>
      ) : (
        <pre className="max-w-full overflow-x-auto rounded-md border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap break-words">
          {config.url}
        </pre>
      )}
      {config.transport === "stdio" && config.env.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs text-muted-foreground">环境变量</span>
          <ul className="flex flex-col gap-0.5">
            {config.env.map((item) => (
              <li key={item.key} className="font-mono text-xs break-all">
                {item.key}={item.value}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {config.transport === "http" && config.headers.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs text-muted-foreground">请求头</span>
          <ul className="flex flex-col gap-0.5">
            {config.headers.map((item) => (
              <li key={item.key} className="font-mono text-xs break-all">
                {item.key}: {item.value}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {config.tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {config.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}
      <span className="text-xs text-muted-foreground">
        创建于 {formatDateTime(config.createdAt)} · 最近修改{" "}
        {formatRelative(config.updatedAt)}
      </span>
    </div>
  )
}

type ServerDetailProps = {
  server: McpServer
  tab: McpTab
  onSelectTab: (tab: McpTab) => void
  onBack: () => void
  /** 连接或断开进行中：动作按钮禁用，防重复提交。 */
  busy: boolean
  onConnect: () => void
  onDisconnect: () => void
  onEdit: () => void
  onDelete: () => Promise<boolean>
}

/**
 * 服务器详情。
 *
 * 顶部的连接状态、失败原因与「能力可能已过期」提示常驻可见；能力分区只展示
 * 服务端真的声明过的内容，没有的能力不假装成可用的空入口。
 */
export const ServerDetail = (props: ServerDetailProps) => {
  const { server } = props
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deleting = useDialogSubmit(() => setConfirmDelete(false))
  useHistoryOverlay(confirmDelete, () => setConfirmDelete(false))

  const connected = server.status.state === "connected"
  const connecting = server.status.state === "connecting"
  const capabilities = server.capabilities
  const counts = {
    tools: capabilities?.tools.length ?? 0,
    resources:
      (capabilities?.resources.length ?? 0) +
      (capabilities?.resourceTemplates.length ?? 0),
    prompts: capabilities?.prompts.length ?? 0,
  }
  const callDisabledReason = connected
    ? null
    : `当前${CONNECTION_LABELS[server.status.state]}，不能调用；请先连接服务器。`

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-col gap-2 border-b px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="返回服务器列表"
            title="返回列表"
            className="md:hidden"
            onClick={props.onBack}
          >
            <ArrowLeft />
          </Button>
          <h1 className="min-w-0 truncate text-sm font-medium">
            {server.config.name}
          </h1>
          <Badge variant={CONNECTION_VARIANTS[server.status.state]}>
            {CONNECTION_LABELS[server.status.state]}
          </Badge>
          {!server.config.enabled ? (
            <Badge variant="outline">已停用</Badge>
          ) : null}
          {server.serverInfo ? (
            <span className="text-xs text-muted-foreground">
              {server.serverInfo.name} v{server.serverInfo.version} · 协议{" "}
              {server.serverInfo.protocolVersion}
            </span>
          ) : null}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {connected ? (
              <ActionButton
                variant="outline"
                size="sm"
                className="px-3"
                busy={props.busy}
                busyLabel="断开中"
                onClick={props.onDisconnect}
              >
                <Plug aria-hidden="true" />
                断开
              </ActionButton>
            ) : (
              <ActionButton
                variant="outline"
                size="sm"
                className="px-3"
                busy={props.busy || connecting}
                busyLabel="连接中"
                onClick={props.onConnect}
              >
                <PlugZap aria-hidden="true" />
                连接
              </ActionButton>
            )}
            <Button
              variant="outline"
              size="sm"
              className="px-3"
              disabled={props.busy}
              onClick={props.onEdit}
            >
              <Pencil aria-hidden="true" />
              编辑
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="px-3 text-destructive"
              disabled={props.busy}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 aria-hidden="true" />
              删除
            </Button>
          </div>
        </div>

        {server.config.description ? (
          <p className="text-xs break-words text-muted-foreground">
            {server.config.description}
          </p>
        ) : null}

        <ToggleGroup
          variant="outline"
          className="flex-wrap"
          value={[props.tab]}
          onValueChange={(values) => {
            const next = values[0]
            if (next) props.onSelectTab(next as McpTab)
          }}
        >
          {MCP_TABS.map((item) => (
            <ToggleGroupItem key={item.key} value={item.key} className="px-3">
              {item.label}
              {item.key === "tools" && counts.tools > 0
                ? ` ${counts.tools}`
                : ""}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </header>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
        <div className="mx-auto flex min-w-0 max-w-3xl flex-col gap-4">
          {server.status.state === "failed" && server.status.lastError ? (
            <Alert variant="destructive">
              <AlertTitle>连接失败</AlertTitle>
              <AlertDescription>
                {server.status.lastError}
                <br />
                修好配置（例如换成有效的凭据）之后再点「连接」重试。
              </AlertDescription>
            </Alert>
          ) : null}

          {server.status.state === "disconnected" && capabilities ? (
            <Alert>
              <AlertTitle>当前未连接</AlertTitle>
              <AlertDescription>
                下面的能力来自上次成功连接（
                {formatRelative(capabilities.fetchedAt)}），可能已经过期；
                调用前需要先连接。
              </AlertDescription>
            </Alert>
          ) : null}

          {server.status.state === "disconnected" && !capabilities ? (
            <Alert>
              <AlertTitle>当前未连接</AlertTitle>
              <AlertDescription>
                连上以后才会读到这台服务器声明的工具、资源与提示词。
              </AlertDescription>
            </Alert>
          ) : null}

          <ConfigSummary server={server} />

          <Separator />

          {props.tab === "tools" ? (
            <ToolsPanel server={server} disabledReason={callDisabledReason} />
          ) : null}
          {props.tab === "resources" ? (
            <ResourcesPanel
              server={server}
              disabledReason={callDisabledReason}
            />
          ) : null}
          {props.tab === "prompts" ? (
            <PromptsPanel server={server} disabledReason={callDisabledReason} />
          ) : null}
          {props.tab === "records" ? (
            <div className="flex min-w-0 flex-col gap-4">
              <CallRecords serverId={server.config.id} />
              {server.config.transport === "stdio" ? (
                <ServerLogs server={server} />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除服务器「{server.config.name}」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              只删除这里的配置与调用记录，不会删除这台服务器访问的文件、远程资源，
              也不会卸载它对应的本机程序。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting.busy}>取消</AlertDialogCancel>
            <ActionButton
              variant="destructive"
              busy={deleting.busy}
              busyLabel="删除中"
              onClick={() => void deleting.submit(() => props.onDelete())}
            >
              删除「{server.config.name}」
            </ActionButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
