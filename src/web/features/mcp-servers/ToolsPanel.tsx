import { describeError } from "@shared/format"
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@web/components/ui/collapsible"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@web/components/ui/empty"
import { Input } from "@web/components/ui/input"
import { useDialogSubmit } from "@web/hooks/use-dialog-submit"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { ChevronRight, Play, Search, Wrench } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { draftToArgs, emptyDraft, type McpFormDraft } from "./form"
import { prettyJson, toolRisk } from "./format"
import { useCallMcpTool } from "./queries"
import { ResultView } from "./ResultView"
import { SchemaForm } from "./SchemaForm"
import type { McpCallRecord, McpServer, McpTool } from "./types"

type ToolsPanelProps = {
  server: McpServer
  /** 非空表示当前不能调用，文案说明原因（未连接或能力已过期）。 */
  disabledReason: string | null
}

type PendingCall = { tool: McpTool; args: Record<string, unknown> }

/**
 * 单个工具的试用区。
 *
 * 参数表单按 schema 生成，同时把「将发送的 JSON」原样展示出来：调试工具时
 * 需要看到最终发出去的东西，而不是只相信自己填的表单。
 */
const ToolTrial = (props: {
  server: McpServer
  tool: McpTool
  disabledReason: string | null
  busy: boolean
  lastRecord: McpCallRecord | null
  onCall: (tool: McpTool, args: Record<string, unknown>) => void
  onCancel: () => void
}) => {
  const { tool } = props
  const [draft, setDraft] = useState<McpFormDraft>(() =>
    emptyDraft(tool.inputSchema)
  )
  const [errors, setErrors] = useState<Record<string, string>>({})

  const risk = toolRisk(tool)
  const converted = draftToArgs(tool.inputSchema, draft)
  const disabled = props.disabledReason !== null || props.busy

  const submit = (): void => {
    const result = draftToArgs(tool.inputSchema, draft)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    props.onCall(tool, result.args)
  }

  return (
    <Collapsible className="group/tool">
      <div className="rounded-lg border">
        <CollapsibleTrigger
          render={
            <button
              type="button"
              className="flex w-full min-w-0 items-start gap-2 rounded-lg p-3 text-left hover:bg-muted/50"
            >
              <ChevronRight
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-data-open/tool:rotate-90"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-medium break-all">
                    {tool.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {tool.title}
                  </span>
                  {risk ? (
                    <Badge variant={risk.variant}>{risk.label}</Badge>
                  ) : null}
                </span>
                <span className="text-xs break-words text-muted-foreground">
                  {tool.description}
                </span>
              </span>
            </button>
          }
        />
        <CollapsibleContent>
          <div className="flex min-w-0 flex-col gap-3 border-t p-3">
            {props.disabledReason ? (
              <p className="text-xs text-muted-foreground">
                {props.disabledReason}
              </p>
            ) : null}

            <SchemaForm
              schema={tool.inputSchema}
              draft={draft}
              errors={errors}
              disabled={disabled}
              idPrefix={`tool-${props.server.config.id}-${tool.name}`}
              onChange={(name, value) => {
                setDraft((previous) => ({ ...previous, [name]: value }))
                setErrors((previous) => {
                  if (!(name in previous)) return previous
                  const next = { ...previous }
                  delete next[name]
                  return next
                })
              }}
            />

            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-xs font-medium">将发送的参数</span>
              <pre className="max-w-full overflow-x-auto rounded-md border bg-muted/40 p-2 font-mono text-xs">
                {prettyJson(converted.ok ? converted.args : draft)}
              </pre>
            </div>

            {tool.annotations.destructive ? (
              <p className="text-xs text-destructive">
                这个工具被服务端标记为「可能改动外部状态」，调用前会再确认一次。
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <ActionButton
                size="sm"
                className="px-3"
                busy={props.busy}
                busyLabel="等待返回中"
                disabled={disabled}
                onClick={submit}
              >
                <Play aria-hidden="true" />
                调用工具
              </ActionButton>
              {props.busy ? (
                <span className="text-xs text-muted-foreground">
                  正在等待服务端返回；超过等待上限会标记为「结果未知」，不会自动重试。
                </span>
              ) : null}
              {props.lastRecord ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto px-3"
                  onClick={props.onCancel}
                >
                  收起结果
                </Button>
              ) : null}
            </div>

            {props.lastRecord ? (
              <div className="flex min-w-0 flex-col gap-2 rounded-lg border bg-muted/20 p-3">
                <span className="text-xs font-medium">本次调用结果</span>
                <ResultView record={props.lastRecord} />
              </div>
            ) : null}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

/**
 * 工具分区：搜索 + 逐条展开试用。
 *
 * 破坏性调用走 AlertDialog 二次确认，明确列出服务器、工具与最终参数；
 * 前端确认只是提示，后端仍会自行校验目标与权限。
 */
export const ToolsPanel = (props: ToolsPanelProps) => {
  const { server } = props
  const tools = server.capabilities?.tools ?? []
  const call = useCallMcpTool()
  const [keyword, setKeyword] = useState("")
  const [busyTool, setBusyTool] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingCall | null>(null)
  const [results, setResults] = useState<Record<string, McpCallRecord>>({})

  const confirming = useDialogSubmit(() => setPending(null))
  useHistoryOverlay(pending !== null, () => setPending(null))

  const run = async (
    tool: McpTool,
    args: Record<string, unknown>
  ): Promise<void> => {
    setBusyTool(tool.name)
    try {
      const record = await call.mutateAsync({
        serverId: server.config.id,
        toolName: tool.name,
        args,
      })
      setResults((previous) => ({ ...previous, [tool.name]: record }))
    } catch (error) {
      // 参数或连接层面的失败在工具卡片内持续展示，不用一闪而过的 toast。
      toast.error(describeError(error))
    } finally {
      setBusyTool(null)
    }
  }

  const requestCall = (tool: McpTool, args: Record<string, unknown>): void => {
    if (tool.annotations.destructive) {
      setPending({ tool, args })
      return
    }
    void run(tool, args)
  }

  const normalized = keyword.trim().toLowerCase()
  const visible =
    normalized === ""
      ? tools
      : tools.filter((tool) =>
          [tool.name, tool.title, tool.description].some((text) =>
            text.toLowerCase().includes(normalized)
          )
        )

  if (tools.length === 0) {
    return (
      <Empty className="py-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Wrench />
          </EmptyMedia>
          <EmptyTitle>还没有拿到工具清单</EmptyTitle>
          <EmptyDescription>
            连上服务器后才会读到它声明的工具；未连接的服务器不显示任何工具。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">工具</h2>
        <p className="text-xs text-muted-foreground">
          共 {tools.length} 个；展开后可填参并调用
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Input
          id="mcp-tool-search"
          aria-label="搜索工具"
          placeholder="按名称或说明搜索"
          autoComplete="off"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <Search
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          没有匹配「{keyword.trim()}」的工具。
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          {visible.map((tool) => (
            <ToolTrial
              key={tool.name}
              server={server}
              tool={tool}
              disabledReason={props.disabledReason}
              busy={busyTool === tool.name}
              lastRecord={results[tool.name] ?? null}
              onCall={requestCall}
              onCancel={() =>
                setResults((previous) => {
                  const next = { ...previous }
                  delete next[tool.name]
                  return next
                })
              }
            />
          ))}
        </div>
      )}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              真的调用「{pending?.tool.name ?? ""}」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              这个工具被标记为可能改动外部状态。它会在服务器「
              {server.config.name}」上真实执行，可能写入文件、改配置或启动进程，
              且多数情况下不能撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Alert variant="destructive">
            <AlertTitle>将发送的参数</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 max-h-48 max-w-full overflow-auto font-mono text-xs">
                {prettyJson(pending?.args ?? {})}
              </pre>
            </AlertDescription>
          </Alert>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirming.busy}>
              取消
            </AlertDialogCancel>
            <ActionButton
              variant="destructive"
              busy={confirming.busy}
              busyLabel="调用中"
              onClick={() => {
                const target = pending
                if (!target) return
                void confirming.submit(async () => {
                  await run(target.tool, target.args)
                  return true
                })
              }}
            >
              确认调用「{pending?.tool.name ?? ""}」
            </ActionButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
