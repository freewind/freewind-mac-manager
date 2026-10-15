import { Checkbox } from "@web/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@web/components/ui/field"
import { Input } from "@web/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@web/components/ui/select"
import { Textarea } from "@web/components/ui/textarea"
import type { McpFormDraft } from "./form"
import type { McpJsonSchema, McpJsonSchemaProperty } from "./types"

type SchemaFormProps = {
  schema: McpJsonSchema
  draft: McpFormDraft
  errors: Record<string, string>
  disabled: boolean
  /** 同一页可能同时出现多份表单，用它保证 id 唯一。 */
  idPrefix: string
  onChange: (name: string, value: string | boolean) => void
}

/** 需要多行输入更顺手的常见参数名。 */
const MULTILINE = new Set(["content", "text", "prompt", "instruction", "body"])

const placeholderOf = (property: McpJsonSchemaProperty): string => {
  if (property.enum) return "请选择"
  if (property.type === "array") return "每行一项"
  if (property.type === "object") return '{ "key": "value" }'
  if (property.type === "integer" || property.type === "number") {
    return "填数字"
  }
  return "填写内容"
}

const hintOf = (property: McpJsonSchemaProperty): string | null => {
  const limits: string[] = []
  if (property.minimum !== undefined) limits.push(`最小 ${property.minimum}`)
  if (property.maximum !== undefined) limits.push(`最大 ${property.maximum}`)
  const suffix = limits.length > 0 ? `（${limits.join("，")}）` : ""
  if (!property.description && suffix === "") return null
  return `${property.description ?? ""}${suffix}` || null
}

/**
 * 由 JSON Schema 生成的入参表单。
 *
 * 只覆盖本页能表达的类型（字符串、数字、布尔、字符串数组、对象），
 * 遇到不认识的形状时退化成 JSON 文本输入，不假装支持全部 schema。
 */
export const SchemaForm = (props: SchemaFormProps) => {
  const entries = Object.entries(props.schema.properties)

  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        这个工具不需要参数，可以直接调用。
      </p>
    )
  }

  return (
    <FieldGroup>
      {entries.map(([name, property]) => {
        const id = `${props.idPrefix}-${name}`
        const required = props.schema.required.includes(name)
        const value = props.draft[name]
        const error = props.errors[name]
        const hint = hintOf(property)

        return (
          <Field key={name} data-invalid={error ? true : undefined}>
            {property.type === "boolean" ? (
              <>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={value === true}
                    disabled={props.disabled}
                    onCheckedChange={(checked) =>
                      props.onChange(name, checked === true)
                    }
                  />
                  <FieldLabel htmlFor={id}>
                    {name}
                    {required ? "（必填）" : ""}
                  </FieldLabel>
                </div>
                {hint ? <FieldDescription>{hint}</FieldDescription> : null}
              </>
            ) : (
              <>
                <FieldLabel htmlFor={id}>
                  {name}
                  {required ? "（必填）" : ""}
                </FieldLabel>
                {property.enum ? (
                  <Select
                    value={
                      typeof value === "string" && value !== "" ? value : null
                    }
                    disabled={props.disabled}
                    onValueChange={(next) => props.onChange(name, next ?? "")}
                  >
                    <SelectTrigger id={id} className="w-full" aria-label={name}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {property.enum.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : property.type === "array" ||
                  property.type === "object" ||
                  MULTILINE.has(name) ? (
                  <Textarea
                    id={id}
                    rows={property.type === "object" ? 4 : 3}
                    value={typeof value === "string" ? value : ""}
                    placeholder={placeholderOf(property)}
                    disabled={props.disabled}
                    onChange={(event) =>
                      props.onChange(name, event.target.value)
                    }
                  />
                ) : (
                  <Input
                    id={id}
                    value={typeof value === "string" ? value : ""}
                    placeholder={placeholderOf(property)}
                    autoComplete="off"
                    inputMode={
                      property.type === "integer" || property.type === "number"
                        ? "decimal"
                        : undefined
                    }
                    disabled={props.disabled}
                    onChange={(event) =>
                      props.onChange(name, event.target.value)
                    }
                  />
                )}
                {hint ? <FieldDescription>{hint}</FieldDescription> : null}
              </>
            )}
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
        )
      })}
    </FieldGroup>
  )
}
