import type {
  CallToolResult,
  ContentBlock,
  ReadResourceResult,
  Resource,
  ResourceTemplate,
  Tool,
} from "@earendil-works/pi-mcp"
import type {
  McpCapabilities,
  McpContentBlock,
  McpJsonSchema,
  McpJsonSchemaProperty,
  McpPrompt,
  McpPromptArgument,
  McpResource,
  McpResourceTemplate,
  McpTool,
  McpToolAnnotations,
} from "@shared/api-contract"
import {
  MCP_MAX_CONTENT_BLOCKS,
  MCP_MAX_DESCRIPTION_CHARS,
  MCP_MAX_IMAGE_BYTES,
  MCP_MAX_PROMPTS,
  MCP_MAX_RESOURCE_TEMPLATES,
  MCP_MAX_RESOURCES,
  MCP_MAX_SCHEMA_PROPERTIES,
  MCP_MAX_TEXT_BYTES,
  MCP_MAX_TOOLS,
} from "./limits"

/**
 * 把真实 MCP 服务端返回的东西收敛成本域契约能表达的形状。
 *
 * 两条原则：
 * - 不认识就退化，不假装支持。任意 JSON Schema 收敛成六种类型；表达不了的
 *   形状退化成 JSON 文本输入，而不是猜一个错的结构。
 * - 一切都有上限。服务端可能是别人的进程，返回超大内容时截断并明确标注，
 *   而不是把库和内存撑爆。
 */

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback

/** 按字符数截断，超出部分丢弃并标注，避免把长描述整段塞进页面。 */
const clampChars = (text: string, maxChars: number): string =>
  text.length <= maxChars ? text : `${text.slice(0, maxChars)}…（已截断）`

/** 按 UTF-8 字节截断；截断处可能留下替换字符，调用方会补一句说明。 */
const clampBytes = (
  text: string,
  maxBytes: number
): { text: string; truncated: boolean } => {
  const buffer = Buffer.from(text, "utf8")
  if (buffer.length <= maxBytes) return { text, truncated: false }
  return {
    text: buffer.subarray(0, maxBytes).toString("utf8"),
    truncated: true,
  }
}

const SCHEMA_TYPES: readonly McpJsonSchemaProperty["type"][] = [
  "string",
  "integer",
  "number",
  "boolean",
  "array",
  "object",
]

const isSchemaType = (value: unknown): value is McpJsonSchemaProperty["type"] =>
  typeof value === "string" &&
  (SCHEMA_TYPES as readonly string[]).includes(value)

/** default 只保留能安全序列化的简单值；其余丢掉，宁可没有默认值。 */
const safeDefault = (value: unknown): { value?: unknown } => {
  if (value === undefined) return {}
  try {
    const text = JSON.stringify(value)
    if (text === undefined || text.length > 4096) return {}
    return { value: JSON.parse(text) as unknown }
  } catch {
    return {}
  }
}

const normalizeProperty = (raw: unknown): McpJsonSchemaProperty => {
  const record = asRecord(raw)
  if (record === null) return { type: "object" }

  // 不认识的 type（含缺失、数组、null）一律当对象处理，让用户填 JSON。
  const type = isSchemaType(record.type) ? record.type : "object"

  const property: McpJsonSchemaProperty = { type }

  const description = asString(record.description)
  if (description !== "") {
    property.description = clampChars(description, MCP_MAX_DESCRIPTION_CHARS)
  }

  const defaults = safeDefault(record.default)
  if ("value" in defaults) property.default = defaults.value

  if (Array.isArray(record.enum)) {
    const options = record.enum.filter(
      (item): item is string => typeof item === "string"
    )
    // 只有全部是字符串才当枚举；混了别的类型就退回普通输入。
    if (options.length === record.enum.length && options.length <= 50) {
      property.enum = options
    }
  }

  if (type === "array") {
    const items = asRecord(record.items)
    if (items !== null && items.type === "string") {
      property.items = { type: "string" }
    }
  }

  for (const key of ["minimum", "maximum"] as const) {
    const value = record[key]
    if (typeof value === "number" && Number.isFinite(value)) {
      property[key] = value
    }
  }

  return property
}

/**
 * 归一化工具入参 schema。
 * 只保留 properties 与 required；required 里出现但 properties 里没有的名字丢掉，
 * 否则表单会渲染出一个填不了的必填项。
 */
export const normalizeInputSchema = (raw: unknown): McpJsonSchema => {
  const record = asRecord(raw)
  const properties: Record<string, McpJsonSchemaProperty> = {}
  const rawProperties = asRecord(record?.properties) ?? {}
  let count = 0
  for (const [name, value] of Object.entries(rawProperties)) {
    if (count >= MCP_MAX_SCHEMA_PROPERTIES) break
    properties[name] = normalizeProperty(value)
    count += 1
  }

  const required = Array.isArray(record?.required)
    ? record.required.filter(
        (item): item is string => typeof item === "string" && item in properties
      )
    : []

  return { type: "object", properties, required }
}

/**
 * 工具的副作用标注。
 *
 * 按 MCP 规范的默认值处理：destructiveHint 缺省视为 true（宁严勿松），
 * readOnlyHint 为真时不可能有副作用，因此直接覆盖另外两项。
 */
export const normalizeAnnotations = (raw: unknown): McpToolAnnotations => {
  const record = asRecord(raw)
  const readOnly = record?.readOnlyHint === true
  if (readOnly) {
    return { readOnly: true, destructive: false, idempotent: true }
  }
  return {
    readOnly: false,
    destructive: record?.destructiveHint !== false,
    idempotent: record?.idempotentHint === true,
  }
}

const normalizeTool = (raw: Tool): McpTool => ({
  name: asString(raw.name),
  title: asString(raw.title ?? raw.annotations?.title, asString(raw.name)),
  description: clampChars(asString(raw.description), MCP_MAX_DESCRIPTION_CHARS),
  inputSchema: normalizeInputSchema(raw.inputSchema),
  annotations: normalizeAnnotations(raw.annotations),
})

const normalizeResource = (raw: Resource): McpResource => ({
  uri: asString(raw.uri),
  name: asString(raw.name, asString(raw.uri)),
  description: clampChars(asString(raw.description), MCP_MAX_DESCRIPTION_CHARS),
  mimeType: asString(raw.mimeType, "application/octet-stream"),
})

/** 从 RFC 6570 模板里取出变量名，按出现顺序去重。 */
const templateVariables = (uriTemplate: string): string[] => {
  const names: string[] = []
  for (const match of uriTemplate.matchAll(/\{([^}]+)\}/g)) {
    const name = match[1].trim()
    if (name !== "" && !names.includes(name)) names.push(name)
  }
  return names
}

const normalizeResourceTemplate = (
  raw: ResourceTemplate
): McpResourceTemplate => {
  const uriTemplate = asString(raw.uriTemplate)
  return {
    uriTemplate,
    name: asString(raw.name, uriTemplate),
    description: clampChars(
      asString(raw.description),
      MCP_MAX_DESCRIPTION_CHARS
    ),
    mimeType: asString(raw.mimeType, "application/octet-stream"),
    variables: templateVariables(uriTemplate),
  }
}

/** prompts/list 的条目形状；pi-mcp 的客户端没有专门的提示词方法，这里自行收窄。 */
const normalizePrompt = (raw: unknown): McpPrompt | null => {
  const record = asRecord(raw)
  if (record === null) return null
  const name = asString(record.name)
  if (name === "") return null

  const args: McpPromptArgument[] = []
  if (Array.isArray(record.arguments)) {
    for (const item of record.arguments) {
      const argument = asRecord(item)
      if (argument === null) continue
      const argumentName = asString(argument.name)
      if (argumentName === "") continue
      args.push({
        name: argumentName,
        description: clampChars(
          asString(argument.description),
          MCP_MAX_DESCRIPTION_CHARS
        ),
        required: argument.required === true,
      })
    }
  }

  return {
    name,
    title: asString(record.title, name),
    description: clampChars(
      asString(record.description),
      MCP_MAX_DESCRIPTION_CHARS
    ),
    arguments: args,
  }
}

const textBlock = (text: string): McpContentBlock => {
  const clamped = clampBytes(text, MCP_MAX_TEXT_BYTES)
  return {
    type: "text",
    text: clamped.truncated
      ? `${clamped.text}\n\n（内容超过 ${MCP_MAX_TEXT_BYTES} 字节，已截断）`
      : clamped.text,
  }
}

const resourceBlock = (
  uri: string,
  mimeType: string,
  text: string
): McpContentBlock => {
  const clamped = clampBytes(text, MCP_MAX_TEXT_BYTES)
  return {
    type: "resource",
    uri,
    mimeType,
    text: clamped.truncated
      ? `${clamped.text}\n\n（内容超过 ${MCP_MAX_TEXT_BYTES} 字节，已截断）`
      : clamped.text,
  }
}

const imageBlock = (mimeType: string, data: string): McpContentBlock => {
  // base64 长度换算成原始字节数；超过上限就只留一句说明，不把大图传给浏览器。
  const bytes = Math.floor((data.length * 3) / 4)
  if (bytes > MCP_MAX_IMAGE_BYTES) {
    return textBlock(
      `图片内容为 ${mimeType}，约 ${bytes} 字节，超过本页 ${MCP_MAX_IMAGE_BYTES} 字节的预览上限，未返回图像数据。`
    )
  }
  return {
    type: "image",
    mimeType,
    bytes,
    previewDataUrl: `data:${mimeType};base64,${data}`,
  }
}

const normalizeContentBlock = (raw: ContentBlock): McpContentBlock | null => {
  switch (raw.type) {
    case "text":
      return textBlock(asString(raw.text))
    case "image":
      return imageBlock(asString(raw.mimeType, "image/png"), asString(raw.data))
    case "audio":
      return textBlock(
        `服务端返回了一段 ${asString(raw.mimeType, "audio")} 音频，本页不播放音频内容。`
      )
    case "resource_link":
      return textBlock(
        `资源链接：${asString(raw.name, asString(raw.uri))}\n${asString(raw.uri)}`
      )
    case "resource": {
      const resource = raw.resource
      const uri = asString(resource.uri)
      const mimeType = asString(resource.mimeType, "text/plain")
      // 文本与二进制资源是同一个联合类型，没有判别字段，只能按字段存在性收窄。
      if ("text" in resource && typeof resource.text === "string") {
        return resourceBlock(uri, mimeType, resource.text)
      }
      const blob = "blob" in resource ? asString(resource.blob) : ""
      const bytes = Math.floor((blob.length * 3) / 4)
      return resourceBlock(
        uri,
        mimeType,
        `二进制资源，约 ${bytes} 字节，本页不展示二进制内容。`
      )
    }
    default:
      return null
  }
}

/**
 * 内容块列表的总量收敛：限制块数量，并保证总字节不超过给定预算。
 * 超出预算的块直接丢弃，并在末尾补一句说明，而不是悄悄少给内容。
 */
export const capContentBlocks = (
  blocks: McpContentBlock[],
  maxBytes: number
): McpContentBlock[] => {
  const kept: McpContentBlock[] = []
  let used = 0
  let dropped = 0
  for (const block of blocks) {
    if (kept.length >= MCP_MAX_CONTENT_BLOCKS) {
      dropped += 1
      continue
    }
    const size = Buffer.byteLength(JSON.stringify(block) ?? "", "utf8")
    if (used + size > maxBytes) {
      dropped += 1
      continue
    }
    used += size
    kept.push(block)
  }
  if (dropped > 0) {
    kept.push(textBlock(`另有 ${dropped} 个内容块超过展示上限，已省略。`))
  }
  return kept
}

export const normalizeCallToolResult = (
  result: CallToolResult,
  maxBytes: number
): { content: McpContentBlock[]; isError: boolean } => {
  const blocks: McpContentBlock[] = []
  for (const raw of result.content ?? []) {
    const block = normalizeContentBlock(raw)
    if (block !== null) blocks.push(block)
  }
  // 有些服务端只给结构化结果，不镜像成文本；这里补成 JSON 块，避免页面空白。
  if (blocks.length === 0 && result.structuredContent !== undefined) {
    blocks.push({ type: "json", value: result.structuredContent })
  }
  return {
    content: capContentBlocks(blocks, maxBytes),
    isError: result.isError === true,
  }
}

export const normalizeReadResourceResult = (
  result: ReadResourceResult,
  maxBytes: number
): McpContentBlock[] => {
  const blocks: McpContentBlock[] = []
  for (const item of result.contents ?? []) {
    const uri = asString(item.uri)
    const mimeType = asString(item.mimeType, "text/plain")
    if ("text" in item && typeof item.text === "string") {
      blocks.push(resourceBlock(uri, mimeType, item.text))
      continue
    }
    const blob = "blob" in item ? asString(item.blob) : ""
    blocks.push(
      resourceBlock(
        uri,
        mimeType,
        `二进制资源，约 ${Math.floor((blob.length * 3) / 4)} 字节，本页不展示二进制内容。`
      )
    )
  }
  return capContentBlocks(blocks, maxBytes)
}

export const normalizePrompts = (raw: unknown): McpPrompt[] => {
  if (!Array.isArray(raw)) return []
  const prompts: McpPrompt[] = []
  for (const item of raw.slice(0, MCP_MAX_PROMPTS)) {
    const prompt = normalizePrompt(item)
    if (prompt !== null) prompts.push(prompt)
  }
  return prompts
}

/** 汇总一次连接读到的全部能力；超出上限的条目被截掉。 */
export const normalizeCapabilities = (input: {
  tools: Tool[]
  resources: Resource[]
  resourceTemplates: ResourceTemplate[]
  prompts: unknown
  fetchedAt: number
}): McpCapabilities => ({
  tools: input.tools.slice(0, MCP_MAX_TOOLS).map(normalizeTool),
  resources: input.resources.slice(0, MCP_MAX_RESOURCES).map(normalizeResource),
  resourceTemplates: input.resourceTemplates
    .slice(0, MCP_MAX_RESOURCE_TEMPLATES)
    .map(normalizeResourceTemplate),
  prompts: normalizePrompts(input.prompts),
  fetchedAt: input.fetchedAt,
})
