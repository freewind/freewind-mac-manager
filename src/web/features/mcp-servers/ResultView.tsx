import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import { Copy } from "lucide-react"
import { toast } from "sonner"
import {
  CALL_STATUS_LABELS,
  CALL_STATUS_VARIANTS,
  formatBytes,
  formatClock,
  formatDuration,
  prettyJson,
} from "./format"
import type { McpCallRecord, McpContentBlock } from "./types"

/**
 * 内容块没有 id，用自身内容派生稳定 key。
 * 同一记录里出现重复内容时再加序号，不依赖数组下标。
 */
const withKeys = (
  blocks: McpContentBlock[]
): { key: string; block: McpContentBlock }[] => {
  const seen = new Map<string, number>()
  return blocks.map((block) => {
    const base =
      block.type === "text"
        ? `text:${block.text.slice(0, 40)}`
        : block.type === "json"
          ? `json:${JSON.stringify(block.value).slice(0, 40)}`
          : block.type === "image"
            ? `image:${block.mimeType}:${block.bytes}`
            : `resource:${block.uri}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return { key: `${base}#${count}`, block }
  })
}

const ContentBlock = (props: { block: McpContentBlock }) => {
  const { block } = props

  if (block.type === "text") {
    return (
      <pre className="max-w-full overflow-x-auto rounded-md border bg-muted/40 p-2.5 font-mono text-xs whitespace-pre-wrap break-words">
        {block.text}
      </pre>
    )
  }

  if (block.type === "json") {
    return (
      <pre className="max-w-full overflow-x-auto rounded-md border bg-muted/40 p-2.5 font-mono text-xs">
        {prettyJson(block.value)}
      </pre>
    )
  }

  if (block.type === "image") {
    return (
      <figure className="flex max-w-full flex-col gap-1.5">
        <img
          src={block.previewDataUrl}
          alt="工具返回的图片内容"
          className="w-full max-w-md rounded-md border"
        />
        <figcaption className="text-xs text-muted-foreground">
          {block.mimeType} · {formatBytes(block.bytes)} ·
          演示占位图，真实调用会返回实际截图
        </figcaption>
      </figure>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant="outline">资源</Badge>
        <span className="min-w-0 truncate font-mono text-xs">{block.uri}</span>
        <span className="text-xs text-muted-foreground">{block.mimeType}</span>
      </div>
      <pre className="max-w-full overflow-x-auto rounded-md border bg-muted/40 p-2.5 font-mono text-xs whitespace-pre-wrap break-words">
        {block.text}
      </pre>
    </div>
  )
}

/** 复制一段文本；剪贴板不可用时明确报错，不假装复制成功。 */
const copyText = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text)
    toast.success("已复制到剪贴板")
  } catch {
    toast.error("复制失败：当前环境不允许访问剪贴板")
  }
}

const resultTextOf = (record: McpCallRecord): string =>
  record.content
    .map((block) => {
      if (block.type === "text") return block.text
      if (block.type === "json") return prettyJson(block.value)
      if (block.type === "image")
        return `[图片 ${block.mimeType} ${formatBytes(block.bytes)}]`
      return `[资源 ${block.uri}]\n${block.text}`
    })
    .join("\n\n")

/**
 * 调用结果展示。
 *
 * 四种状态分开呈现：超时是「结果未知」而不是失败，因此不给重试暗示，
 * 只说明「需要重新读取目标或查询任务状态」。
 */
export const ResultView = (props: { record: McpCallRecord }) => {
  const { record } = props

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={CALL_STATUS_VARIANTS[record.status]}>
          {CALL_STATUS_LABELS[record.status]}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {formatClock(record.startedAt)} · 耗时{" "}
          {formatDuration(record.durationMs)}
        </span>
        {record.content.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto px-3"
            onClick={() => void copyText(resultTextOf(record))}
          >
            <Copy aria-hidden="true" />
            复制结果
          </Button>
        ) : null}
      </div>

      {record.error ? (
        <Alert
          variant={
            record.status === "timeout-unknown" ? "default" : "destructive"
          }
        >
          <AlertTitle>
            {record.status === "timeout-unknown"
              ? "结果未知，需要核实"
              : "调用没有正常完成"}
          </AlertTitle>
          <AlertDescription>{record.error}</AlertDescription>
        </Alert>
      ) : null}

      {record.content.length === 0 ? (
        record.error ? null : (
          <p className="text-sm text-muted-foreground">工具返回了空内容。</p>
        )
      ) : (
        withKeys(record.content).map(({ key, block }) => (
          <ContentBlock key={key} block={block} />
        ))
      )}
    </div>
  )
}
