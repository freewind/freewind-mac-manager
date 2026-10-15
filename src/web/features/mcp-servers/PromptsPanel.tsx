import { describeError } from "@shared/format"
import { ActionButton } from "@web/components/ActionButton"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@web/components/ui/collapsible"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@web/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@web/components/ui/field"
import { Input } from "@web/components/ui/input"
import { ChevronRight, MessageSquareText, Play } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { useGetMcpPrompt } from "./queries"
import { ResultView } from "./ResultView"
import type { McpCallRecord, McpPrompt, McpServer } from "./types"

type PromptsPanelProps = {
  server: McpServer
  disabledReason: string | null
}

/**
 * 单个提示词：展开后按声明好的参数填写，再获取渲染后的消息。
 *
 * 提示词只是文本模板，不会自己调用模型；这里展示的是「服务端会交给模型的
 * 那段消息」，方便确认模板与参数是否对得上。
 */
const PromptItem = (props: {
  prompt: McpPrompt
  disabledReason: string | null
  onGet: (name: string, args: Record<string, unknown>) => Promise<McpCallRecord>
}) => {
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [record, setRecord] = useState<McpCallRecord | null>(null)

  const disabled = props.disabledReason !== null || busy

  const submit = async (): Promise<void> => {
    const found: Record<string, string> = {}
    for (const argument of props.prompt.arguments) {
      if (argument.required && (values[argument.name]?.trim() ?? "") === "") {
        found[argument.name] = "必填项不能为空"
      }
    }
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setBusy(true)
    try {
      setRecord(await props.onGet(props.prompt.name, values))
    } catch (error) {
      toast.error(describeError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Collapsible className="group/prompt">
      <div className="rounded-lg border">
        <CollapsibleTrigger
          render={
            <button
              type="button"
              className="flex w-full min-w-0 items-start gap-2 rounded-lg p-3 text-left hover:bg-muted/50"
            >
              <ChevronRight
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-data-open/prompt:rotate-90"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-medium break-all">
                    {props.prompt.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {props.prompt.title}
                  </span>
                </span>
                <span className="text-xs break-words text-muted-foreground">
                  {props.prompt.description}
                </span>
              </span>
            </button>
          }
        />
        <CollapsibleContent>
          <div className="flex min-w-0 flex-col gap-3 border-t p-3">
            {props.prompt.arguments.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                这个提示词不需要参数，可以直接获取。
              </p>
            ) : (
              <FieldGroup>
                {props.prompt.arguments.map((argument) => {
                  const id = `mcp-prompt-${props.prompt.name}-${argument.name}`
                  return (
                    <Field
                      key={argument.name}
                      data-invalid={errors[argument.name] ? true : undefined}
                    >
                      <FieldLabel htmlFor={id}>
                        {argument.name}
                        {argument.required ? "（必填）" : ""}
                      </FieldLabel>
                      <Input
                        id={id}
                        value={values[argument.name] ?? ""}
                        autoComplete="off"
                        placeholder={argument.description}
                        disabled={disabled}
                        onChange={(event) => {
                          const next = event.target.value
                          setValues((previous) => ({
                            ...previous,
                            [argument.name]: next,
                          }))
                          setErrors((previous) => {
                            if (!(argument.name in previous)) return previous
                            const rest = { ...previous }
                            delete rest[argument.name]
                            return rest
                          })
                        }}
                      />
                      {argument.description ? (
                        <FieldDescription>
                          {argument.description}
                        </FieldDescription>
                      ) : null}
                    </Field>
                  )
                })}
              </FieldGroup>
            )}

            <ActionButton
              size="sm"
              className="self-start px-3"
              busy={busy}
              busyLabel="获取中"
              disabled={disabled}
              onClick={() => void submit()}
            >
              <Play aria-hidden="true" />
              获取提示词
            </ActionButton>

            {record ? (
              <div className="flex min-w-0 flex-col gap-2 rounded-lg border bg-muted/20 p-3">
                <span className="text-xs font-medium">渲染后的消息</span>
                <ResultView record={record} />
              </div>
            ) : null}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

export const PromptsPanel = (props: PromptsPanelProps) => {
  const prompts = props.server.capabilities?.prompts ?? []
  const get = useGetMcpPrompt()

  if (prompts.length === 0) {
    return (
      <Empty className="py-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageSquareText />
          </EmptyMedia>
          <EmptyTitle>这个服务器没有声明提示词</EmptyTitle>
          <EmptyDescription>
            提示词是服务端提供的消息模板，没有声明时不显示入口。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">提示词</h2>
        <p className="text-xs text-muted-foreground">共 {prompts.length} 个</p>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        {prompts.map((prompt) => (
          <PromptItem
            key={prompt.name}
            prompt={prompt}
            disabledReason={props.disabledReason}
            onGet={(name, args) =>
              get.mutateAsync({
                serverId: props.server.config.id,
                name,
                args,
              })
            }
          />
        ))}
      </div>
    </section>
  )
}
