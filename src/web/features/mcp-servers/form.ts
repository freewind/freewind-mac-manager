import type { McpJsonSchema, McpJsonSchemaProperty } from "./types"

/**
 * 工具入参的编辑草稿。
 *
 * 表单里所有输入都以字符串保存（布尔单独处理），只在真正发起调用时转成
 * 有类型的参数。这样数组/JSON 这类多行输入不会因为「边打边转换」而丢字。
 */
export type McpFormDraft = Record<string, string | boolean>

const defaultDraftValue = (
  property: McpJsonSchemaProperty
): string | boolean => {
  if (property.type === "boolean") return property.default === true
  if (property.default === undefined || property.default === null) return ""
  if (Array.isArray(property.default)) return property.default.join("\n")
  if (typeof property.default === "object") {
    return JSON.stringify(property.default, null, 2)
  }
  return String(property.default)
}

/** 按 schema 的默认值建一份空白草稿。 */
export const emptyDraft = (schema: McpJsonSchema): McpFormDraft => {
  const draft: McpFormDraft = {}
  for (const [name, property] of Object.entries(schema.properties)) {
    draft[name] = defaultDraftValue(property)
  }
  return draft
}

export type DraftResult =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; errors: Record<string, string> }

/**
 * 把草稿转成调用参数。
 *
 * 只做 schema 能表达的校验（必填、类型、范围），不做业务校验：参数是否
 * 真的有意义只有服务端知道，前端不要假装能提前拦住。
 */
export const draftToArgs = (
  schema: McpJsonSchema,
  draft: McpFormDraft
): DraftResult => {
  const args: Record<string, unknown> = {}
  const errors: Record<string, string> = {}

  for (const [name, property] of Object.entries(schema.properties)) {
    const raw = draft[name]
    if (property.type === "boolean") {
      args[name] = raw === true
      continue
    }

    const text = typeof raw === "string" ? raw.trim() : ""
    if (text === "") {
      if (schema.required.includes(name)) errors[name] = "必填项不能为空"
      continue
    }

    if (property.type === "string") {
      args[name] = text
      continue
    }

    if (property.type === "integer" || property.type === "number") {
      const parsed = Number(text)
      if (!Number.isFinite(parsed)) {
        errors[name] = "需要填数字"
      } else if (property.type === "integer" && !Number.isInteger(parsed)) {
        errors[name] = "需要填整数"
      } else if (property.minimum !== undefined && parsed < property.minimum) {
        errors[name] = `不能小于 ${property.minimum}`
      } else if (property.maximum !== undefined && parsed > property.maximum) {
        errors[name] = `不能大于 ${property.maximum}`
      } else {
        args[name] = parsed
      }
      continue
    }

    if (property.type === "array") {
      args[name] = text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
      continue
    }

    try {
      args[name] = JSON.parse(text)
    } catch {
      errors[name] = "不是合法 JSON"
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, args }
}
