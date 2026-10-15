import { z } from "zod"

/**
 * MCP Servers 域的契约 schema。
 *
 * 这些形状刻意与真实 MCP 协议对齐（initialize / tools/list / tools/call /
 * resources/read / prompts/get），只是把服务端返回的任意 JSON Schema 收敛成
 * 本域表单能表达的子集，收敛规则在 server/mcp-servers/normalize.ts。
 */

export const MCP_TRANSPORTS = ["stdio", "http"] as const
export const McpTransportSchema = z.enum(MCP_TRANSPORTS)

export const MCP_CONNECTION_STATES = [
  "connected",
  "connecting",
  "disconnected",
  "failed",
] as const
export const McpConnectionStateSchema = z.enum(MCP_CONNECTION_STATES)

/** 环境变量与请求头都按有序键值对传输：同名键只留一条，顺序即界面顺序。 */
export const McpKeyValueSchema = z.object({
  key: z.string().max(256),
  value: z.string().max(4096),
})

export const McpServerConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  description: z.string().max(300),
  transport: McpTransportSchema,
  /** stdio：启动命令、参数、工作目录与环境变量；http 时留空。 */
  command: z.string().max(1024),
  args: z.array(z.string().max(4096)).max(64),
  cwd: z.string().max(1024).nullable(),
  env: z.array(McpKeyValueSchema).max(64),
  /** http：服务地址与请求头；stdio 时留空。 */
  url: z.string().max(2048),
  headers: z.array(McpKeyValueSchema).max(64),
  enabled: z.boolean(),
  tags: z.array(z.string().max(40)).max(12),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const McpServerInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  protocolVersion: z.string(),
})

export const McpServerStatusSchema = z.object({
  state: McpConnectionStateSchema,
  connectedAt: z.number().nullable(),
  /** 最近一次连接失败的原因；连接成功后清空。 */
  lastError: z.string().nullable(),
})

export const MCP_JSON_SCHEMA_TYPES = [
  "string",
  "integer",
  "number",
  "boolean",
  "array",
  "object",
] as const

export const McpJsonSchemaPropertySchema = z.object({
  type: z.enum(MCP_JSON_SCHEMA_TYPES),
  description: z.string().optional(),
  default: z.unknown().optional(),
  /** 全部是字符串时才保留；否则退化成普通字符串输入。 */
  enum: z.array(z.string()).optional(),
  /** 仅 array 使用，当前只支持字符串数组。 */
  items: z.object({ type: z.literal("string") }).optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
})

export const McpJsonSchemaSchema = z.object({
  type: z.literal("object"),
  properties: z.record(z.string(), McpJsonSchemaPropertySchema),
  required: z.array(z.string()),
})

export const McpToolAnnotationsSchema = z.object({
  /** 只读提示：来自服务端声明，仅作提示，不当作安全保证。 */
  readOnly: z.boolean(),
  destructive: z.boolean(),
  idempotent: z.boolean(),
})

export const McpToolSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string(),
  inputSchema: McpJsonSchemaSchema,
  annotations: McpToolAnnotationsSchema,
})

export const McpResourceSchema = z.object({
  uri: z.string(),
  name: z.string(),
  description: z.string(),
  mimeType: z.string(),
})

export const McpResourceTemplateSchema = z.object({
  uriTemplate: z.string(),
  name: z.string(),
  description: z.string(),
  mimeType: z.string(),
  /** 模板里需要填写的变量名，按出现顺序。 */
  variables: z.array(z.string()),
})

export const McpPromptArgumentSchema = z.object({
  name: z.string(),
  description: z.string(),
  required: z.boolean(),
})

export const McpPromptSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string(),
  arguments: z.array(McpPromptArgumentSchema),
})

export const McpCapabilitiesSchema = z.object({
  tools: z.array(McpToolSchema),
  resources: z.array(McpResourceSchema),
  resourceTemplates: z.array(McpResourceTemplateSchema),
  prompts: z.array(McpPromptSchema),
  /** 能力清单的读取时间；断开后仍保留，用于标注「可能已过期」。 */
  fetchedAt: z.number(),
})

export const McpServerSchema = z.object({
  config: McpServerConfigSchema,
  status: McpServerStatusSchema,
  serverInfo: McpServerInfoSchema.nullable(),
  /** 从未成功连接过时为 null。 */
  capabilities: McpCapabilitiesSchema.nullable(),
})

export const MCP_CONTENT_BLOCK_TYPES = [
  "text",
  "json",
  "image",
  "resource",
] as const

/** 图片内容块只带可预览的 data URL；超过上限的图片被截断成说明文字。 */
export const McpContentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("json"), value: z.unknown() }),
  z.object({
    type: z.literal("image"),
    mimeType: z.string(),
    bytes: z.number().int().min(0),
    previewDataUrl: z.string(),
  }),
  z.object({
    type: z.literal("resource"),
    uri: z.string(),
    mimeType: z.string(),
    text: z.string(),
  }),
])

export const MCP_CALL_KINDS = ["tool", "resource", "prompt"] as const
export const McpCallKindSchema = z.enum(MCP_CALL_KINDS)

/**
 * 调用结果状态。
 * ok：协议层正常返回；tool-error：工具自己报告失败（MCP 的 isError）；
 * protocol-error：连接或协议层失败；timeout-unknown：等待超时，**结果未知**。
 */
export const MCP_CALL_STATUSES = [
  "ok",
  "tool-error",
  "protocol-error",
  "timeout-unknown",
] as const
export const McpCallStatusSchema = z.enum(MCP_CALL_STATUSES)

export const McpCallRecordSchema = z.object({
  id: z.string().min(1),
  serverId: z.string().min(1),
  serverName: z.string(),
  kind: McpCallKindSchema,
  name: z.string(),
  status: McpCallStatusSchema,
  startedAt: z.number(),
  durationMs: z.number().int().min(0),
  /** 发起时的入参，便于复现。 */
  request: z.unknown(),
  content: z.array(McpContentBlockSchema),
  error: z.string().nullable(),
})

export const McpServersResponseSchema = z.object({
  servers: z.array(McpServerSchema),
  /** 本次读取时间（毫秒），页面据此标明数据新鲜度。 */
  readAt: z.number(),
})

export const McpCapabilitiesResponseSchema = z.object({
  capabilities: McpCapabilitiesSchema.nullable(),
  /** true 表示当前未连接，内容来自上次成功连接的缓存，可能已过期。 */
  stale: z.boolean(),
  connected: z.boolean(),
})

export const McpCallsQuerySchema = z.object({
  serverId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

export const McpCallsResponseSchema = z.object({
  calls: z.array(McpCallRecordSchema),
  limit: z.number().int().min(1),
})

/** 服务端 stderr 的尾部若干行，用于排错；不返回完整日志。 */
export const McpLogsResponseSchema = z.object({
  lines: z.array(z.string()),
  truncated: z.boolean(),
})

export const McpServerIdPathParamsSchema = z.object({ id: z.string().min(1) })

/**
 * 新增与修改配置。
 * 跨字段一致性（stdio 必须有命令、http 必须是 http(s) 地址）在服务端校验，
 * 因为只有服务端知道当前的传输方式与其它服务器占用的名称。
 */
export const McpServerInputSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(300).default(""),
  transport: McpTransportSchema,
  command: z.string().max(1024).default(""),
  args: z.array(z.string().max(4096)).max(64).default([]),
  cwd: z.string().max(1024).nullable().default(null),
  env: z.array(McpKeyValueSchema).max(64).default([]),
  url: z.string().max(2048).default(""),
  headers: z.array(McpKeyValueSchema).max(64).default([]),
  enabled: z.boolean().default(true),
  tags: z.array(z.string().max(40)).max(12).default([]),
})

export const McpToolCallInputSchema = z.object({
  toolName: z.string().min(1).max(256),
  args: z.record(z.string(), z.unknown()).default({}),
  /**
   * 服务端声明为可能改动外部状态的工具必须显式确认。
   * 前端确认不是安全边界，后端在这里再拦一次，未确认就不执行。
   */
  acknowledgedRisk: z.boolean().default(false),
})

export const McpResourceReadInputSchema = z.object({
  uri: z.string().min(1).max(4096),
})

export const McpPromptGetInputSchema = z.object({
  name: z.string().min(1).max(256),
  args: z.record(z.string(), z.unknown()).default({}),
})
