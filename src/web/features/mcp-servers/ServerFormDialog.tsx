import type {
  McpKeyValue,
  McpServer,
  McpServerInput,
  McpTransport,
} from "@shared/api-contract"
import { ActionButton } from "@web/components/ActionButton"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import { Checkbox } from "@web/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog"
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
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

/**
 * 环境变量/请求头的编辑行。
 * 多一个 id 是为了让每行在增删时有稳定身份，不靠数组下标做 key。
 */
type KeyValueRow = { id: string; key: string; value: string }

let rowSequence = 0
const nextRowId = (): string => {
  rowSequence += 1
  return `row-${rowSequence}`
}

const toRows = (items: McpKeyValue[]): KeyValueRow[] =>
  items.map((item) => ({ id: nextRowId(), ...item }))

const rowsToKeyValues = (rows: KeyValueRow[]): McpKeyValue[] =>
  rows.map((row) => ({ key: row.key, value: row.value }))

type FormState = {
  name: string
  description: string
  transport: McpTransport
  command: string
  argsText: string
  cwd: string
  env: KeyValueRow[]
  url: string
  headers: KeyValueRow[]
  enabled: boolean
  tagsText: string
}

const emptyForm = (): FormState => ({
  name: "",
  description: "",
  transport: "stdio",
  command: "",
  argsText: "",
  cwd: "",
  env: [],
  url: "",
  headers: [],
  enabled: true,
  tagsText: "",
})

const formOf = (server: McpServer): FormState => ({
  name: server.config.name,
  description: server.config.description,
  transport: server.config.transport,
  command: server.config.command,
  argsText: server.config.args.join("\n"),
  cwd: server.config.cwd ?? "",
  env: toRows(server.config.env),
  url: server.config.url,
  headers: toRows(server.config.headers),
  enabled: server.config.enabled,
  tagsText: server.config.tags.join("、"),
})

const toInput = (form: FormState): McpServerInput => ({
  name: form.name.trim(),
  description: form.description.trim(),
  transport: form.transport,
  command: form.transport === "stdio" ? form.command.trim() : "",
  args:
    form.transport === "stdio"
      ? form.argsText
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== "")
      : [],
  cwd:
    form.transport === "stdio" && form.cwd.trim() !== ""
      ? form.cwd.trim()
      : null,
  env: form.transport === "stdio" ? rowsToKeyValues(form.env) : [],
  url: form.transport === "http" ? form.url.trim() : "",
  headers: form.transport === "http" ? rowsToKeyValues(form.headers) : [],
  enabled: form.enabled,
  tags: form.tagsText
    .split(/[、,，]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag !== ""),
})

/** 环境变量 / 请求头的行编辑器：key 为空的行在提交时会被丢掉。 */
const KeyValueEditor = (props: {
  label: string
  hint: string
  rows: KeyValueRow[]
  disabled: boolean
  onChange: (rows: KeyValueRow[]) => void
}) => (
  <Field>
    <FieldLabel>{props.label}</FieldLabel>
    <div className="flex flex-col gap-2">
      {props.rows.map((row, index) => (
        <div key={row.id} className="flex items-center gap-2">
          <Input
            aria-label={`${props.label}第 ${index + 1} 项的键`}
            value={row.key}
            autoComplete="off"
            placeholder="名称"
            disabled={props.disabled}
            onChange={(event) =>
              props.onChange(
                props.rows.map((item, position) =>
                  position === index
                    ? { ...item, key: event.target.value }
                    : item
                )
              )
            }
          />
          <Input
            aria-label={`${props.label}第 ${index + 1} 项的值`}
            value={row.value}
            autoComplete="off"
            placeholder="值"
            disabled={props.disabled}
            onChange={(event) =>
              props.onChange(
                props.rows.map((item, position) =>
                  position === index
                    ? { ...item, value: event.target.value }
                    : item
                )
              )
            }
          />
          <Button
            variant="outline"
            size="icon"
            className="size-9 shrink-0 text-destructive"
            aria-label={`删除${props.label}第 ${index + 1} 项`}
            disabled={props.disabled}
            onClick={() =>
              props.onChange(
                props.rows.filter((_, position) => position !== index)
              )
            }
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start px-3"
        disabled={props.disabled}
        onClick={() =>
          props.onChange([
            ...props.rows,
            { id: nextRowId(), key: "", value: "" },
          ])
        }
      >
        <Plus aria-hidden="true" />
        添加一行
      </Button>
    </div>
    <FieldDescription>{props.hint}</FieldDescription>
  </Field>
)

type ParsedServer = { name: string; spec: Record<string, unknown> }

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []

const asKeyValues = (value: unknown): McpKeyValue[] => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return []
  return Object.entries(value as Record<string, unknown>).map(
    ([key, item]) => ({
      key,
      value: typeof item === "string" ? item : JSON.stringify(item),
    })
  )
}

/**
 * 解析粘贴进来的 MCP JSON 配置。
 *
 * 同时接受常见客户端的 `{ "mcpServers": { ... } }` 形状和直接的 `{ name: spec }`
 * 形状；不认识的字段忽略，但会把「识别到几个服务器」如实告诉用户。
 */
const parseJsonConfig = (
  text: string
): { ok: true; servers: ParsedServer[] } | { ok: false; message: string } => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, message: "不是合法 JSON" }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: "顶层需要是一个对象" }
  }
  const root = parsed as Record<string, unknown>
  const container =
    typeof root.mcpServers === "object" &&
    root.mcpServers !== null &&
    !Array.isArray(root.mcpServers)
      ? (root.mcpServers as Record<string, unknown>)
      : root

  const servers: ParsedServer[] = []
  for (const [name, spec] of Object.entries(container)) {
    if (typeof spec !== "object" || spec === null || Array.isArray(spec))
      continue
    servers.push({ name, spec: spec as Record<string, unknown> })
  }
  if (servers.length === 0) {
    return { ok: false, message: "没有识别到任何服务器条目" }
  }
  return { ok: true, servers }
}

const formFromParsed = (parsed: ParsedServer): FormState => {
  const spec = parsed.spec
  const url = typeof spec.url === "string" ? spec.url : ""
  const transport: McpTransport = url !== "" ? "http" : "stdio"
  return {
    ...emptyForm(),
    name: parsed.name,
    description: typeof spec.description === "string" ? spec.description : "",
    transport,
    command: typeof spec.command === "string" ? spec.command : "",
    argsText: asStringArray(spec.args).join("\n"),
    cwd: typeof spec.cwd === "string" ? spec.cwd : "",
    env: toRows(asKeyValues(spec.env)),
    url,
    headers: toRows(asKeyValues(spec.headers)),
    enabled: spec.disabled !== true,
  }
}

type ServerFormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 传入服务器表示编辑，null 表示新增。 */
  server: McpServer | null
  busy: boolean
  failure: string | null
  onSubmit: (input: McpServerInput) => Promise<boolean>
}

/**
 * 新增 / 编辑 MCP Server。
 *
 * 保存配置与连接是两件事：这里只写配置，写完仍是未连接状态，需要用户显式点
 * 「连接」。启动本机命令前，页面会把将要执行的命令原样展示出来。
 */
export const ServerFormDialog = (props: ServerFormDialogProps) => {
  const [form, setForm] = useState<FormState>(() =>
    props.server === null ? emptyForm() : formOf(props.server)
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [jsonText, setJsonText] = useState("")

  useHistoryOverlay(props.open, () => props.onOpenChange(false))

  const patch = (next: Partial<FormState>): void =>
    setForm((previous) => ({ ...previous, ...next }))

  const applyJson = (): void => {
    const result = parseJsonConfig(jsonText)
    if (!result.ok) {
      toast.error(`解析失败：${result.message}`)
      return
    }
    const [first] = result.servers
    patch(formFromParsed(first))
    toast.success(
      result.servers.length === 1
        ? `已填入「${first.name}」`
        : `识别到 ${result.servers.length} 个服务器，已填入第一个「${first.name}」`
    )
  }

  const validate = (): Record<string, string> => {
    const found: Record<string, string> = {}
    if (form.name.trim() === "") found.name = "请填写名称"
    if (form.transport === "stdio" && form.command.trim() === "") {
      found.command = "请填写启动命令"
    }
    if (form.transport === "http") {
      if (form.url.trim() === "") found.url = "请填写服务地址"
      else if (!/^https?:\/\//.test(form.url.trim())) {
        found.url = "地址需要以 http:// 或 https:// 开头"
      }
    }
    return found
  }

  const submit = async (): Promise<void> => {
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) return
    if (await props.onSubmit(toInput(form))) props.onOpenChange(false)
  }

  const prefix = props.server === null ? "new" : props.server.config.id

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {props.server === null
              ? "添加 MCP Server"
              : `编辑「${props.server.config.name}」`}
          </DialogTitle>
          <DialogDescription>
            保存只写配置，不会立刻启动进程或发起网络请求；写完再点「连接」。
          </DialogDescription>
        </DialogHeader>

        {props.failure ? (
          <Alert variant="destructive">
            <AlertTitle>这份配置没能保存</AlertTitle>
            <AlertDescription>{props.failure}</AlertDescription>
          </Alert>
        ) : null}

        {props.server === null ? (
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <span className="text-sm font-medium">从 JSON 粘贴</span>
            <p className="text-xs text-muted-foreground">
              支持 {`{ "mcpServers": { "名称": { "command": ... } } }`}{" "}
              这种常见形状， 解析后填入下面的表单，可再手工修改。
            </p>
            <Textarea
              aria-label="MCP JSON 配置"
              rows={5}
              value={jsonText}
              placeholder={
                '{\n  "mcpServers": {\n    "my-server": { "command": "npx", "args": ["-y", "pkg"] }\n  }\n}'
              }
              disabled={props.busy}
              onChange={(event) => setJsonText(event.target.value)}
            />
            <Button
              variant="outline"
              size="sm"
              className="self-start px-3"
              disabled={props.busy || jsonText.trim() === ""}
              onClick={applyJson}
            >
              解析并填入表单
            </Button>
          </div>
        ) : null}

        <FieldGroup>
          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor={`mcp-${prefix}-name`}>名称（必填）</FieldLabel>
            <Input
              id={`mcp-${prefix}-name`}
              value={form.name}
              autoComplete="off"
              placeholder="例如 github"
              disabled={props.busy}
              onChange={(event) => patch({ name: event.target.value })}
            />
            <FieldDescription>用于在页面里识别这台服务器。</FieldDescription>
            {errors.name ? <FieldError>{errors.name}</FieldError> : null}
          </Field>

          <Field>
            <FieldLabel htmlFor={`mcp-${prefix}-description`}>说明</FieldLabel>
            <Textarea
              id={`mcp-${prefix}-description`}
              rows={2}
              value={form.description}
              placeholder="这台服务器提供什么能力"
              disabled={props.busy}
              onChange={(event) => patch({ description: event.target.value })}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={`mcp-${prefix}-transport`}>
              传输方式
            </FieldLabel>
            <Select
              value={form.transport}
              disabled={props.busy}
              onValueChange={(next) =>
                patch({ transport: (next ?? "stdio") as McpTransport })
              }
            >
              <SelectTrigger
                id={`mcp-${prefix}-transport`}
                className="w-full"
                aria-label="传输方式"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">stdio（本机进程）</SelectItem>
                <SelectItem value="http">Streamable HTTP（远程）</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {form.transport === "stdio" ? (
            <>
              <Field data-invalid={errors.command ? true : undefined}>
                <FieldLabel htmlFor={`mcp-${prefix}-command`}>
                  启动命令（必填）
                </FieldLabel>
                <Input
                  id={`mcp-${prefix}-command`}
                  value={form.command}
                  autoComplete="off"
                  placeholder="例如 npx"
                  disabled={props.busy}
                  onChange={(event) => patch({ command: event.target.value })}
                />
                {errors.command ? (
                  <FieldError>{errors.command}</FieldError>
                ) : null}
              </Field>

              <Field>
                <FieldLabel htmlFor={`mcp-${prefix}-args`}>命令参数</FieldLabel>
                <Textarea
                  id={`mcp-${prefix}-args`}
                  rows={3}
                  value={form.argsText}
                  placeholder={
                    "每行一个参数，例如\n-y\n@modelcontextprotocol/server-memory"
                  }
                  disabled={props.busy}
                  onChange={(event) => patch({ argsText: event.target.value })}
                />
                <FieldDescription>
                  参数原样传给进程，不经过 shell 解析，因此不会被执行命令注入。
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor={`mcp-${prefix}-cwd`}>工作目录</FieldLabel>
                <Input
                  id={`mcp-${prefix}-cwd`}
                  value={form.cwd}
                  autoComplete="off"
                  placeholder="留空则用服务进程当前目录"
                  disabled={props.busy}
                  onChange={(event) => patch({ cwd: event.target.value })}
                />
              </Field>

              <KeyValueEditor
                label="环境变量"
                hint="会追加到服务进程的环境里；值可能含密钥，页面上按原样保存。"
                rows={form.env}
                disabled={props.busy}
                onChange={(env) => patch({ env })}
              />
            </>
          ) : (
            <>
              <Field data-invalid={errors.url ? true : undefined}>
                <FieldLabel htmlFor={`mcp-${prefix}-url`}>
                  服务地址（必填）
                </FieldLabel>
                <Input
                  id={`mcp-${prefix}-url`}
                  value={form.url}
                  autoComplete="off"
                  placeholder="例如 https://example.com/mcp"
                  disabled={props.busy}
                  onChange={(event) => patch({ url: event.target.value })}
                />
                <FieldDescription>
                  远程服务只允许 http(s) 地址。
                </FieldDescription>
                {errors.url ? <FieldError>{errors.url}</FieldError> : null}
              </Field>

              <KeyValueEditor
                label="请求头"
                hint="例如 Authorization；值会随请求发出。"
                rows={form.headers}
                disabled={props.busy}
                onChange={(headers) => patch({ headers })}
              />
            </>
          )}

          <Field>
            <FieldLabel htmlFor={`mcp-${prefix}-tags`}>标签</FieldLabel>
            <Input
              id={`mcp-${prefix}-tags`}
              value={form.tagsText}
              autoComplete="off"
              placeholder="用、或逗号分隔，例如：本机、工具目录"
              disabled={props.busy}
              onChange={(event) => patch({ tagsText: event.target.value })}
            />
          </Field>

          <Field>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`mcp-${prefix}-enabled`}
                checked={form.enabled}
                disabled={props.busy}
                onCheckedChange={(checked) =>
                  patch({ enabled: checked === true })
                }
              />
              <FieldLabel htmlFor={`mcp-${prefix}-enabled`}>
                启用这台服务器
              </FieldLabel>
            </div>
            <FieldDescription>
              停用后不参与自动连接，但仍保留配置与能力清单。
            </FieldDescription>
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={props.busy}
            onClick={() => props.onOpenChange(false)}
          >
            取消
          </Button>
          <ActionButton
            busy={props.busy}
            busyLabel="保存中"
            onClick={() => void submit()}
          >
            {props.server === null ? "添加服务器" : "保存修改"}
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
