/**
 * MCP Servers 页的域内类型。
 *
 * 本页当前只做前端演示：这些类型描述的是「一个 MCP 客户端该有什么」，
 * 与真实 MCP 协议（initialize / tools/list / tools/call 等）对齐，
 * 后续接后端时按同一形状落契约，页面不必重写。
 */

export type McpTransport = "stdio" | "http"

/**
 * 连接状态。
 * connecting 表示正在建立连接，此时能力清单还不可信；
 * failed 与 disconnected 的区别是「连过但失败」和「从未连接或已主动断开」。
 */
export type McpConnectionState =
  | "connected"
  | "connecting"
  | "disconnected"
  | "failed"

export type McpKeyValue = { key: string; value: string }

export type McpServerConfig = {
  id: string
  name: string
  description: string
  transport: McpTransport
  /** stdio：启动命令、参数、工作目录与环境变量；http 时留空。 */
  command: string
  args: string[]
  cwd: string | null
  env: McpKeyValue[]
  /** http：服务地址与请求头；stdio 时留空。 */
  url: string
  headers: McpKeyValue[]
  enabled: boolean
  tags: string[]
  createdAt: number
  updatedAt: number
}

export type McpServerInfo = {
  name: string
  version: string
  protocolVersion: string
}

export type McpServerStatus = {
  state: McpConnectionState
  connectedAt: number | null
  /** 最近一次连接失败的原因；连接成功后清空。 */
  lastError: string | null
}

export type McpJsonSchemaProperty = {
  type: "string" | "integer" | "number" | "boolean" | "array" | "object"
  description?: string
  default?: unknown
  /** 有枚举时表单用下拉选择，不再让用户手打。 */
  enum?: string[]
  /** 仅 array 使用，当前只支持字符串数组。 */
  items?: { type: "string" }
  minimum?: number
  maximum?: number
}

/** 工具入参 schema；只覆盖本页表单能表达的子集。 */
export type McpJsonSchema = {
  type: "object"
  properties: Record<string, McpJsonSchemaProperty>
  required: string[]
}

export type McpToolAnnotations = {
  /** 只读提示：来自服务端声明，仅作提示，不当作安全保证。 */
  readOnly: boolean
  destructive: boolean
  idempotent: boolean
}

export type McpTool = {
  name: string
  title: string
  description: string
  inputSchema: McpJsonSchema
  annotations: McpToolAnnotations
}

export type McpResource = {
  uri: string
  name: string
  description: string
  mimeType: string
}

export type McpResourceTemplate = {
  uriTemplate: string
  name: string
  description: string
  mimeType: string
  /** 模板里需要填写的变量名，按出现顺序。 */
  variables: string[]
}

export type McpPromptArgument = {
  name: string
  description: string
  required: boolean
}

export type McpPrompt = {
  name: string
  title: string
  description: string
  arguments: McpPromptArgument[]
}

export type McpCapabilities = {
  tools: McpTool[]
  resources: McpResource[]
  resourceTemplates: McpResourceTemplate[]
  prompts: McpPrompt[]
  /** 能力清单的读取时间；断开后仍保留，用于标注「可能已过期」。 */
  fetchedAt: number
}

export type McpServer = {
  config: McpServerConfig
  status: McpServerStatus
  serverInfo: McpServerInfo | null
  /** 从未成功连接过时为 null。 */
  capabilities: McpCapabilities | null
}

export type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "json"; value: unknown }
  | { type: "image"; mimeType: string; bytes: number; previewDataUrl: string }
  | { type: "resource"; uri: string; mimeType: string; text: string }

export type McpCallKind = "tool" | "resource" | "prompt"

/**
 * 调用结果状态。
 * ok：正常返回，内容里仍可能有 isError 之外的业务失败说明；
 * tool-error：工具自己报告失败（MCP 的 isError）；
 * protocol-error：连接或协议层失败；
 * timeout-unknown：等待超时，**结果未知**——既不能当失败，也不能自动重试。
 */
export type McpCallStatus =
  | "ok"
  | "tool-error"
  | "protocol-error"
  | "timeout-unknown"

export type McpCallRecord = {
  id: string
  serverId: string
  serverName: string
  kind: McpCallKind
  name: string
  status: McpCallStatus
  startedAt: number
  durationMs: number
  /** 发起时的入参，便于复现。 */
  request: unknown
  content: McpContentBlock[]
  error: string | null
}

export type McpServerInput = {
  name: string
  description: string
  transport: McpTransport
  command: string
  args: string[]
  cwd: string | null
  env: McpKeyValue[]
  url: string
  headers: McpKeyValue[]
  enabled: boolean
  tags: string[]
}
