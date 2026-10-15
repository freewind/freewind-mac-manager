import type {
  McpCallStatus,
  McpConnectionState,
  McpTool,
  McpTransport,
} from "@shared/api-contract"

type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "ghost"
  | "link"

export const CONNECTION_LABELS: Record<McpConnectionState, string> = {
  connected: "已连接",
  connecting: "连接中",
  disconnected: "未连接",
  failed: "连接失败",
}

export const CONNECTION_VARIANTS: Record<McpConnectionState, BadgeVariant> = {
  connected: "secondary",
  connecting: "outline",
  disconnected: "outline",
  failed: "destructive",
}

export const CALL_STATUS_LABELS: Record<McpCallStatus, string> = {
  ok: "正常返回",
  "tool-error": "工具报告失败",
  "protocol-error": "协议或连接错误",
  "timeout-unknown": "等待超时 · 结果未知",
}

export const CALL_STATUS_VARIANTS: Record<McpCallStatus, BadgeVariant> = {
  ok: "secondary",
  "tool-error": "destructive",
  "protocol-error": "destructive",
  "timeout-unknown": "outline",
}

export const transportLabel = (transport: McpTransport): string =>
  transport === "stdio" ? "stdio（本机进程）" : "Streamable HTTP（远程）"

/** 工具风险提示：来自服务端声明的标注，只是提示，不当作安全保证。 */
export const toolRisk = (
  tool: McpTool
): { label: string; variant: BadgeVariant } | null => {
  if (tool.annotations.destructive) {
    return { label: "可能改动外部状态", variant: "destructive" }
  }
  if (tool.annotations.readOnly) {
    return { label: "只读", variant: "outline" }
  }
  return { label: "有写入", variant: "outline" }
}

export const formatDuration = (milliseconds: number): string =>
  milliseconds < 1000
    ? `${milliseconds} ms`
    : `${(milliseconds / 1000).toFixed(1)} s`

const pad = (value: number): string => String(value).padStart(2, "0")

export const formatClock = (timestamp: number): string => {
  const date = new Date(timestamp)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export const formatDateTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${formatClock(timestamp)}`
}

export const formatRelative = (timestamp: number, now = Date.now()): string => {
  const diff = now - timestamp
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

export const prettyJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
