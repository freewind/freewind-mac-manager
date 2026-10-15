import { describeError } from "@shared/format"
import { ActionButton } from "@web/components/ActionButton"
import { Badge } from "@web/components/ui/badge"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@web/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@web/components/ui/field"
import { Input } from "@web/components/ui/input"
import { ChevronRight, FileText, Play } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { useReadMcpResource } from "./queries"
import { ResultView } from "./ResultView"
import type {
  McpCallRecord,
  McpResource,
  McpResourceTemplate,
  McpServer,
} from "./types"

type ResourcesPanelProps = {
  server: McpServer
  disabledReason: string | null
}

/** 把 uriTemplate 里的 {var} 换成用户填的值；缺项时返回 null 表示还不能读。 */
export const buildUri = (
  template: McpResourceTemplate,
  values: Record<string, string>
): string | null => {
  let result = template.uriTemplate
  for (const name of template.variables) {
    const value = values[name]?.trim() ?? ""
    if (value === "") return null
    result = result.replace(`{${name}}`, value)
  }
  return result
}

const ReadButton = (props: {
  label: string
  busy: boolean
  disabled: boolean
  onClick: () => void
}) => (
  <ActionButton
    size="sm"
    className="shrink-0 px-3"
    busy={props.busy}
    busyLabel="读取中"
    disabled={props.disabled}
    onClick={props.onClick}
  >
    <Play aria-hidden="true" />
    {props.label}
  </ActionButton>
)

const ResultBlock = (props: { record: McpCallRecord | null }) =>
  props.record ? (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border bg-muted/20 p-3">
      <span className="text-xs font-medium">读取结果</span>
      <ResultView record={props.record} />
    </div>
  ) : null

/** 资源模板：按模板变量生成输入框，拼出完整 URI 后再读取。 */
const TemplateItem = (props: {
  template: McpResourceTemplate
  disabledReason: string | null
  onRead: (uri: string) => Promise<McpCallRecord>
}) => {
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [record, setRecord] = useState<McpCallRecord | null>(null)

  const uri = buildUri(props.template, values)
  const disabled = props.disabledReason !== null || busy

  const read = async (): Promise<void> => {
    if (uri === null) return
    setBusy(true)
    try {
      setRecord(await props.onRead(uri))
    } catch (error) {
      toast.error(describeError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-lg border p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{props.template.name}</span>
          <Badge variant="outline">模板</Badge>
          <span className="text-xs text-muted-foreground">
            {props.template.mimeType}
          </span>
        </div>
        <span className="break-all font-mono text-xs text-muted-foreground">
          {props.template.uriTemplate}
        </span>
        <span className="text-xs break-words text-muted-foreground">
          {props.template.description}
        </span>
      </div>

      <FieldGroup>
        {props.template.variables.map((name) => (
          <Field key={name}>
            <FieldLabel htmlFor={`mcp-template-${props.template.name}-${name}`}>
              {name}
            </FieldLabel>
            <Input
              id={`mcp-template-${props.template.name}-${name}`}
              value={values[name] ?? ""}
              autoComplete="off"
              placeholder={`填写 ${name}`}
              disabled={disabled}
              onChange={(event) =>
                setValues((previous) => ({
                  ...previous,
                  [name]: event.target.value,
                }))
              }
            />
          </Field>
        ))}
      </FieldGroup>

      <div className="flex flex-wrap items-center gap-2">
        <ReadButton
          label="读取资源"
          busy={busy}
          disabled={disabled || uri === null}
          onClick={() => void read()}
        />
        <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">
          {uri ?? "填完变量后才能读取"}
        </span>
      </div>

      <ResultBlock record={record} />
    </li>
  )
}

const ResourceItem = (props: {
  resource: McpResource
  disabledReason: string | null
  onRead: (uri: string) => Promise<McpCallRecord>
}) => {
  const [busy, setBusy] = useState(false)
  const [record, setRecord] = useState<McpCallRecord | null>(null)
  const disabled = props.disabledReason !== null || busy

  const read = async (): Promise<void> => {
    setBusy(true)
    try {
      setRecord(await props.onRead(props.resource.uri))
    } catch (error) {
      toast.error(describeError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-lg border p-3">
      <div className="flex min-w-0 flex-wrap items-start gap-2">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{props.resource.name}</span>
            <span className="text-xs text-muted-foreground">
              {props.resource.mimeType}
            </span>
          </span>
          <span className="break-all font-mono text-xs text-muted-foreground">
            {props.resource.uri}
          </span>
          <span className="text-xs break-words text-muted-foreground">
            {props.resource.description}
          </span>
        </span>
        <ReadButton
          label="读取"
          busy={busy}
          disabled={disabled}
          onClick={() => void read()}
        />
      </div>
      <ResultBlock record={record} />
    </li>
  )
}

/** 资源分区：静态资源与资源模板分开列出，模板要先填变量。 */
export const ResourcesPanel = (props: ResourcesPanelProps) => {
  const resources = props.server.capabilities?.resources ?? []
  const templates = props.server.capabilities?.resourceTemplates ?? []
  const read = useReadMcpResource()

  const onRead = (uri: string): Promise<McpCallRecord> =>
    read.mutateAsync({ serverId: props.server.config.id, uri })

  if (resources.length === 0 && templates.length === 0) {
    return (
      <Empty className="py-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileText />
          </EmptyMedia>
          <EmptyTitle>这个服务器没有声明资源</EmptyTitle>
          <EmptyDescription>
            资源是服务端提供的可读数据（文件、日志、索引等），没有声明时不显示入口。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">资源</h2>
        <p className="text-xs text-muted-foreground">
          {resources.length} 个固定资源 · {templates.length} 个资源模板
        </p>
      </div>
      <ul className="flex min-w-0 flex-col gap-2">
        {resources.map((resource) => (
          <ResourceItem
            key={resource.uri}
            resource={resource}
            disabledReason={props.disabledReason}
            onRead={onRead}
          />
        ))}
        {templates.map((template) => (
          <TemplateItem
            key={template.uriTemplate}
            template={template}
            disabledReason={props.disabledReason}
            onRead={onRead}
          />
        ))}
      </ul>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <ChevronRight className="size-3" aria-hidden="true" />
        资源读取是只读操作，但仍要连接成功后才能执行。
      </p>
    </section>
  )
}
