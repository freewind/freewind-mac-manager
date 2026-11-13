import type { PiBenchmarkResult } from "@shared/api-contract"
import { HighlightText } from "@web/components/HighlightText"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@web/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@web/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@web/components/ui/tooltip"
import {
  ChevronDown,
  Copy,
  Ellipsis,
  Eye,
  Gauge,
  LayoutGrid,
  List,
  MessageSquare,
  Plus,
  Trash2,
} from "lucide-react"
import { Fragment, useState } from "react"
import { toast } from "sonner"
import { benchmarkStatusText } from "./benchmark-status"
import type { PlaygroundTarget } from "./PlaygroundTab"
import type { ModelDraft } from "./provider-drafts"
import type { DeleteModelTarget, ProviderEntry } from "./types"
import type { BenchmarkRunTarget } from "./use-pi-benchmark-runs"

type ModelOf = ProviderEntry["provider"]["models"][number]

/** 视图层对页面动作的唯一入口：PiPage 组装，卡片与表格共用。 */
export type ProviderViewActions = {
  startEdit: (entry: ProviderEntry) => void
  deleteProvider: (entry: ProviderEntry) => void
  copyProvider: (entry: ProviderEntry) => void
  copyProviderPending: boolean
  runBenchmarks: (targets: BenchmarkRunTarget[]) => void
  editModel: (draft: ModelDraft) => void
  addModelTo: (providerId: string) => void
  openPlayground: (target: PlaygroundTarget) => void
  copyModelJson: (model: ModelOf) => void
  deleteModel: (target: DeleteModelTarget) => void
  copyApiKey: (providerId: string) => void
}

export type ProviderViewData = {
  busyBenchmarkKeys: Set<string>
  latestBenchmark: Map<string, PiBenchmarkResult>
  pendingTargets: string[]
  now: number
}

/** Provider 菜单：卡片与表格视图共用。 */
const ProviderMenu = (props: {
  entry: ProviderEntry
  anyBenchmarkBusy: boolean
  actions: ProviderViewActions
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`更多操作：${props.entry.id}`}
        >
          <Ellipsis />
        </Button>
      }
    />
    <DropdownMenuContent align="end" className="min-w-44">
      <DropdownMenuItem
        className="min-h-8 text-sm"
        disabled={props.anyBenchmarkBusy}
        onClick={() =>
          props.actions.runBenchmarks(
            props.entry.provider.models.map((model) => ({
              providerId: props.entry.id,
              modelId: model.id,
            }))
          )
        }
      >
        <Gauge />
        整组测速
      </DropdownMenuItem>
      <DropdownMenuItem
        className="min-h-8 text-sm"
        onClick={() => props.actions.startEdit(props.entry)}
      >
        <Eye />
        编辑
      </DropdownMenuItem>
      <DropdownMenuItem
        className="min-h-8 text-sm"
        onClick={() => props.actions.copyProvider(props.entry)}
        disabled={props.actions.copyProviderPending}
      >
        <Copy />
        复制为新 Provider
      </DropdownMenuItem>
      <DropdownMenuItem
        className="min-h-8 text-sm"
        variant="destructive"
        onClick={() => props.actions.deleteProvider(props.entry)}
      >
        <Trash2 />
        删除 Provider
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
)

/** 模型操作组：首字按钮 + 模型菜单，卡片与表格共用。 */
const ModelActions = (props: {
  entry: ProviderEntry
  model: ModelOf
  data: ProviderViewData
  actions: ProviderViewActions
}) => {
  const { entry, model, data, actions } = props
  const key = `${entry.id}/${model.id}`
  const status = benchmarkStatusText(
    data.latestBenchmark.get(key),
    data.pendingTargets.includes(key),
    data.now
  )
  const detail = status?.detail
  const benchmarkButton = (
    <Button
      size="sm"
      variant="outline"
      className={
        status?.failed ? "rounded-r-none text-destructive" : "rounded-r-none"
      }
      disabled={data.busyBenchmarkKeys.has(key)}
      onClick={() =>
        actions.runBenchmarks([{ providerId: entry.id, modelId: model.id }])
      }
    >
      <Gauge />
      {status ? status.text : "首字"}
    </Button>
  )
  return (
    <div className="flex">
      {/* 失败时悬停看完整错误，避免把长文案塞进按钮 */}
      {status?.failed && detail ? (
        <Tooltip>
          <TooltipTrigger render={benchmarkButton} />
          <TooltipContent className="max-w-md items-start">
            <span className="whitespace-pre-wrap break-all">{detail}</span>
            <button
              type="button"
              aria-label="复制错误信息"
              className="shrink-0 rounded-sm p-0.5 hover:bg-background/20"
              onClick={(event) => {
                event.stopPropagation()
                void navigator.clipboard
                  .writeText(detail)
                  .then(() => toast.success("已复制错误信息"))
              }}
            >
              <Copy className="size-3" />
            </button>
          </TooltipContent>
        </Tooltip>
      ) : (
        benchmarkButton
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="sm"
              variant="outline"
              className="rounded-l-none border-l-0 px-1.5"
              aria-label={`「${model.id}」的更多操作`}
            >
              <ChevronDown />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-auto min-w-44">
          <DropdownMenuItem
            className="min-h-8 text-sm"
            onClick={() =>
              actions.editModel({
                providerId: entry.id,
                editingModelId: model.id,
                id: model.id,
                name: model.name ?? "",
                contextWindow:
                  model.contextWindow === undefined
                    ? ""
                    : String(model.contextWindow),
                maxTokens:
                  model.maxTokens === undefined ? "" : String(model.maxTokens),
                json: "",
                reasoning: model.reasoning === true,
                inputText:
                  model.input === undefined || model.input.includes("text"),
                inputImage: model.input?.includes("image") ?? false,
                thinkingLevelMapJson: model.thinkingLevelMap
                  ? JSON.stringify(model.thinkingLevelMap, null, 2)
                  : "",
              })
            }
          >
            <Eye />
            详情
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-8 text-sm"
            onClick={() =>
              actions.openPlayground({
                provider: entry.id,
                model: model.id,
              })
            }
          >
            <MessageSquare />
            打开 Playground
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-8 text-sm"
            onClick={() => actions.copyModelJson(model)}
          >
            <Copy />
            复制模型信息
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-8 text-sm"
            variant="destructive"
            disabled={entry.provider.models.length <= 1}
            onClick={() =>
              actions.deleteModel({
                providerId: entry.id,
                modelId: model.id,
              })
            }
          >
            <Trash2 />
            删除模型
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** 模型一行：标签 + context/输出 + 操作组。 */
const ModelRow = (props: {
  entry: ProviderEntry
  model: ModelOf
  keyword: string
  data: ProviderViewData
  actions: ProviderViewActions
}) => (
  <div className="flex flex-wrap items-center gap-2">
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1 break-all">
      <Badge variant="outline" className="h-6 px-2 text-xs">
        <HighlightText
          text={props.model.name ?? props.model.id}
          keyword={props.keyword}
        />
      </Badge>
      <span>
        {props.model.contextWindow ?? "-"} context /{" "}
        {props.model.maxTokens ?? "-"} 输出
      </span>
    </span>
    <ModelActions
      entry={props.entry}
      model={props.model}
      data={props.data}
      actions={props.actions}
    />
  </div>
)

/** 卡片瀑布流视图。 */
export const ProviderCardView = (props: {
  providers: ProviderEntry[]
  keyword: string
  data: ProviderViewData
  actions: ProviderViewActions
}) => (
  <div className="columns-1 gap-3 sm:columns-2 xl:columns-3">
    {props.providers.map((entry) => (
      <Card key={entry.id} className="mb-3 break-inside-avoid">
        <CardHeader>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <CardTitle className="break-all">
                <HighlightText text={entry.id} keyword={props.keyword} />
              </CardTitle>
              <CardDescription className="mt-1 break-all">
                <HighlightText
                  text={entry.provider.baseUrl}
                  keyword={props.keyword}
                />
              </CardDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-6"
                onClick={() => props.actions.startEdit(entry)}
              >
                <Eye />
                详情
              </Button>
              <ProviderMenu
                entry={entry}
                anyBenchmarkBusy={props.data.busyBenchmarkKeys.size > 0}
                actions={props.actions}
              />
            </div>
          </div>
          <p className="text-xs">
            API：{entry.provider.api} · 模型：{entry.modelCount}
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="space-y-2 text-xs text-muted-foreground">
            {entry.provider.models.map((model) => (
              <ModelRow
                key={model.id}
                entry={entry}
                model={model}
                keyword={props.keyword}
                data={props.data}
                actions={props.actions}
              />
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-1"
            onClick={() => props.actions.addModelTo(entry.id)}
          >
            <Plus />
            添加模型
          </Button>
        </CardContent>
      </Card>
    ))}
  </div>
)

/** 紧凑行视图：provider 列合并单元格，模型逐行展开。 */
export const ProviderTableView = (props: {
  providers: ProviderEntry[]
  keyword: string
  data: ProviderViewData
  actions: ProviderViewActions
}) => (
  <div className="overflow-x-auto rounded-lg border">
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="px-3 py-2 font-medium">Provider</th>
          <th className="px-3 py-2 font-medium">URL</th>
          <th className="px-3 py-2 font-medium">API</th>
          <th className="px-3 py-2 font-medium">密钥</th>
          <th className="px-3 py-2 font-medium">模型</th>
          <th className="px-3 py-2 font-medium">操作</th>
        </tr>
      </thead>
      <tbody>
        {props.providers.map((entry) => {
          const models = entry.provider.models
          const rows: (ModelOf | null)[] = models.length > 0 ? models : [null]
          return (
            <Fragment key={entry.id}>
              {rows.map((model, index) => (
                <tr
                  key={`${entry.id}/${model?.id ?? "none"}`}
                  className="border-b align-top last:border-b-0"
                >
                  {index === 0 ? (
                    <>
                      <td
                        rowSpan={rows.length + 1}
                        className="px-3 py-2 align-top"
                      >
                        <div className="font-medium break-all">
                          <HighlightText
                            text={entry.id}
                            keyword={props.keyword}
                          />
                        </div>
                        {entry.provider.name ? (
                          <div className="text-muted-foreground break-all">
                            {entry.provider.name}
                          </div>
                        ) : null}
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6"
                            onClick={() => props.actions.startEdit(entry)}
                          >
                            <Eye />
                            详情
                          </Button>
                          <ProviderMenu
                            entry={entry}
                            anyBenchmarkBusy={
                              props.data.busyBenchmarkKeys.size > 0
                            }
                            actions={props.actions}
                          />
                        </div>
                      </td>
                      <td
                        rowSpan={rows.length + 1}
                        className="px-3 py-2 align-top text-muted-foreground"
                      >
                        <span className="break-all">
                          <HighlightText
                            text={entry.provider.baseUrl}
                            keyword={props.keyword}
                          />
                        </span>
                      </td>
                      <td
                        rowSpan={rows.length + 1}
                        className="px-3 py-2 align-top text-muted-foreground"
                      >
                        {entry.provider.api}
                      </td>
                      <td
                        rowSpan={rows.length + 1}
                        className="px-3 py-2 align-top text-muted-foreground"
                      >
                        {entry.apiKeyPreview ? (
                          <div className="flex items-center gap-1">
                            <span className="font-mono">
                              {entry.apiKeyPreview}
                            </span>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`复制「${entry.id}」的密钥`}
                              onClick={() => props.actions.copyApiKey(entry.id)}
                            >
                              <Copy />
                            </Button>
                          </div>
                        ) : (
                          "未设置"
                        )}
                      </td>
                    </>
                  ) : null}
                  <td className="px-3 py-2">
                    {model ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="h-6 px-2 text-xs">
                          <HighlightText
                            text={model.name ?? model.id}
                            keyword={props.keyword}
                          />
                        </Badge>
                        <span className="text-muted-foreground">
                          {model.contextWindow ?? "-"} context /{" "}
                          {model.maxTokens ?? "-"} 输出
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">没有模型</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {model ? (
                      <ModelActions
                        entry={entry}
                        model={model}
                        data={props.data}
                        actions={props.actions}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
              <tr className="border-b last:border-b-0">
                <td colSpan={2} className="px-3 pb-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6"
                    onClick={() => props.actions.addModelTo(entry.id)}
                  >
                    <Plus />
                    添加模型
                  </Button>
                </td>
              </tr>
            </Fragment>
          )
        })}
      </tbody>
    </table>
  </div>
)

/** 列表展示方式切换按钮：卡片瀑布流或紧凑行。 */
export const ViewToggleButton = (props: {
  view: "card" | "row"
  onToggle: () => void
  className?: string
}) => (
  <Button
    size="sm"
    variant="outline"
    className={props.className}
    aria-label={
      props.view === "card"
        ? "当前卡片视图，切换为行视图"
        : "当前行视图，切换为卡片视图"
    }
    onClick={props.onToggle}
  >
    {props.view === "card" ? <LayoutGrid /> : <List />}
  </Button>
)

/** 全部测速会真的花钱，先确认一次。 */
export const BenchmarkAllButton = (props: {
  count: number
  busy: boolean
  onConfirm: () => void
}) => {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            disabled={props.count === 0 || props.busy}
          >
            <Gauge />
            {props.busy ? "测速中…" : "全部测速"}
          </Button>
        }
      />
      <PopoverContent className="w-48" align="end">
        <p>全部测速？</p>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setOpen(false)
              props.onConfirm()
            }}
          >
            确认
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
