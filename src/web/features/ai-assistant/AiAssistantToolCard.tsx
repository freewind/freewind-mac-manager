import type { CustomToolRendererProps } from "@web/components/agent-elements/types"
import { Badge } from "@web/components/ui/badge"
import { Link2 } from "lucide-react"

/** 后端工具结果是 pi 的 `{ content: [{ type, text }], details }` 形状。 */
const unwrapToolOutput = (output: unknown): unknown => {
  if (typeof output !== "object" || output === null) return output
  const content = (output as { content?: unknown }).content
  if (!Array.isArray(content)) return output
  const text = content.find(
    (item): item is { type: string; text: string } =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as { text?: unknown }).text === "string"
  )?.text
  if (text === undefined) return output
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const summarize = (value: unknown, limit = 600): string => {
  if (value === undefined || value === null) return ""
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2)
  return text.length > limit ? `${text.slice(0, limit)}\n…` : text
}

/**
 * call_mac_manager_api 的只读展示卡片。
 *
 * 只是展示助手刚才调了哪个接口、结果如何；真正的执行与校验都在后端，
 * 这里不做任何动作，也不提供重试入口。
 */
export const AiAssistantToolCard = (props: CustomToolRendererProps) => {
  const input = props.input ?? {}
  const method = typeof input.method === "string" ? input.method : ""
  const path = typeof input.path === "string" ? input.path : ""
  const unwrapped = unwrapToolOutput(props.output)
  const httpStatus =
    typeof unwrapped === "object" && unwrapped !== null
      ? (unwrapped as { status?: unknown }).status
      : undefined
  const body =
    typeof unwrapped === "object" && unwrapped !== null
      ? (unwrapped as { body?: unknown }).body
      : unwrapped

  const badgeVariant =
    props.status === "error"
      ? ("destructive" as const)
      : props.status === "success"
        ? ("secondary" as const)
        : ("outline" as const)
  const badgeLabel =
    props.status === "error"
      ? "失败"
      : props.status === "success"
        ? typeof httpStatus === "number"
          ? `HTTP ${httpStatus}`
          : "完成"
        : "执行中"

  return (
    <div className="rounded-md border bg-muted/30 p-2 text-xs">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Link2
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="font-mono text-[0.6875rem] font-medium">
          {method} {path}
        </span>
        <Badge variant={badgeVariant}>{badgeLabel}</Badge>
      </div>
      {body !== undefined && body !== null && props.status !== "pending" ? (
        <pre className="mt-2 max-h-40 min-w-0 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-[0.6875rem] text-muted-foreground">
          {summarize(body)}
        </pre>
      ) : null}
    </div>
  )
}
