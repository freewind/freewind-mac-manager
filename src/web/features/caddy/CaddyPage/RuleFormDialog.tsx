import {
  CADDY_MATCH_KINDS,
  type CaddyMatchKind,
  type CaddyRule,
  type CaddyRuleInput,
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
import { useState } from "react"
import { matchKindLabel } from "../format"

type FormState = {
  name: string
  note: string
  matchKind: CaddyMatchKind
  host: string
  pathPrefix: string
  stripPrefix: boolean
  upstream: string
  enabled: boolean
}

const emptyForm = (): FormState => ({
  name: "",
  note: "",
  matchKind: "host",
  host: "",
  pathPrefix: "",
  stripPrefix: true,
  upstream: "",
  enabled: true,
})

const formOf = (rule: CaddyRule): FormState => ({
  name: rule.name,
  note: rule.note,
  matchKind: rule.matchKind,
  host: rule.host ?? "",
  pathPrefix: rule.pathPrefix ?? "",
  stripPrefix: rule.stripPrefix,
  upstream: rule.upstream,
  enabled: rule.enabled,
})

type RuleFormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 传入规则表示编辑，null 表示新增。 */
  rule: CaddyRule | null
  /** 提交中：禁用全部输入与按钮，防重复提交。 */
  busy: boolean
  /** 服务端返回的中文原因（400/409），持续展示在表单里。 */
  failure: string | null
  onSubmit: (input: CaddyRuleInput) => Promise<boolean>
}

/**
 * 新增 / 编辑受管规则。
 *
 * 只做「最明显」的本地校验（必填项），跨字段一致性与唯一性交给服务端，
 * 因为那些规则（重复匹配、前缀重叠）只有服务端能看到全部规则。
 */
export const RuleFormDialog = (props: RuleFormDialogProps) => {
  // 对话框只在打开时挂载，因此这里按当前规则起表单即可：
  // 不需要在 effect 里同步 props（重开时是重新挂载，不会残留上一次的输入）。
  const [form, setForm] = useState<FormState>(() =>
    props.rule === null ? emptyForm() : formOf(props.rule)
  )
  const [errors, setErrors] = useState<Record<string, string>>({})

  useHistoryOverlay(props.open, () => props.onOpenChange(false))

  const patch = (next: Partial<FormState>): void =>
    setForm((previous) => ({ ...previous, ...next }))

  const validate = (): Record<string, string> => {
    const found: Record<string, string> = {}
    if (form.name.trim() === "") found.name = "请填写名称"
    if (form.matchKind === "host" && form.host.trim() === "") {
      found.condition = "请填写域名"
    }
    if (form.matchKind === "path" && form.pathPrefix.trim() === "") {
      found.condition = "请填写路径前缀"
    }
    if (form.upstream.trim() === "") found.upstream = "请填写上游地址"
    return found
  }

  const submit = async (): Promise<void> => {
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) return
    const input: CaddyRuleInput = {
      name: form.name.trim(),
      note: form.note,
      matchKind: form.matchKind,
      // 不用的那一侧填 null：跨字段一致性服务端还会再校验一次。
      host: form.matchKind === "host" ? form.host.trim() : null,
      pathPrefix: form.matchKind === "path" ? form.pathPrefix.trim() : null,
      stripPrefix: form.matchKind === "path" ? form.stripPrefix : false,
      upstream: form.upstream.trim(),
      enabled: form.enabled,
    }
    if (await props.onSubmit(input)) props.onOpenChange(false)
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {props.rule === null
              ? "新增规则"
              : `编辑规则「${props.rule.name}」`}
          </DialogTitle>
          <DialogDescription>
            规则先存进数据库；点「应用变更」之后才会写进 Caddyfile 并重新加载。
          </DialogDescription>
        </DialogHeader>

        {props.failure ? (
          <Alert variant="destructive">
            <AlertTitle>这条规则没能保存</AlertTitle>
            <AlertDescription>{props.failure}</AlertDescription>
          </Alert>
        ) : null}

        <FieldGroup>
          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor="caddy-rule-name">名称（必填）</FieldLabel>
            <Input
              id="caddy-rule-name"
              value={form.name}
              autoComplete="off"
              placeholder="例如 模型服务"
              disabled={props.busy}
              onChange={(event) => patch({ name: event.target.value })}
            />
            <FieldDescription>
              只用于页面识别，不会写进配置文件。
            </FieldDescription>
            {errors.name ? <FieldError>{errors.name}</FieldError> : null}
          </Field>

          <Field>
            <FieldLabel htmlFor="caddy-rule-note">备注</FieldLabel>
            <Textarea
              id="caddy-rule-note"
              value={form.note}
              rows={2}
              placeholder="可选，例如这条规则给谁用"
              disabled={props.busy}
              onChange={(event) => patch({ note: event.target.value })}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="caddy-rule-match-kind">匹配方式</FieldLabel>
            <Select
              value={form.matchKind}
              disabled={props.busy}
              onValueChange={(value) =>
                patch({ matchKind: value as CaddyMatchKind })
              }
            >
              <SelectTrigger
                id="caddy-rule-match-kind"
                className="min-h-11 w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CADDY_MATCH_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {matchKindLabel(kind)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {form.matchKind === "host" ? (
            <Field data-invalid={errors.condition ? true : undefined}>
              <FieldLabel htmlFor="caddy-rule-host">域名（必填）</FieldLabel>
              <Input
                id="caddy-rule-host"
                value={form.host}
                autoComplete="off"
                placeholder="例如 llm.example.com"
                disabled={props.busy}
                onChange={(event) => patch({ host: event.target.value })}
              />
              <FieldDescription>
                按 Host 匹配；通配域名写成 *.example.com。
              </FieldDescription>
              {errors.condition ? (
                <FieldError>{errors.condition}</FieldError>
              ) : null}
            </Field>
          ) : (
            <Field data-invalid={errors.condition ? true : undefined}>
              <FieldLabel htmlFor="caddy-rule-path">
                路径前缀（必填）
              </FieldLabel>
              <Input
                id="caddy-rule-path"
                value={form.pathPrefix}
                autoComplete="off"
                placeholder="例如 /llm/*"
                disabled={props.busy}
                onChange={(event) => patch({ pathPrefix: event.target.value })}
              />
              <FieldDescription>必须以 / 开头。</FieldDescription>
              {errors.condition ? (
                <FieldError>{errors.condition}</FieldError>
              ) : null}
            </Field>
          )}

          <Field data-invalid={errors.upstream ? true : undefined}>
            <FieldLabel htmlFor="caddy-rule-upstream">
              上游地址（必填）
            </FieldLabel>
            <Input
              id="caddy-rule-upstream"
              value={form.upstream}
              autoComplete="off"
              placeholder="例如 127.0.0.1:52390"
              disabled={props.busy}
              onChange={(event) => patch({ upstream: event.target.value })}
            />
            <FieldDescription>
              支持 host:port、http://host:port 或 https://host:port。
            </FieldDescription>
            {errors.upstream ? (
              <FieldError>{errors.upstream}</FieldError>
            ) : null}
          </Field>

          <Field>
            <div className="flex min-h-11 items-center gap-2">
              <Checkbox
                id="caddy-rule-strip-prefix"
                checked={form.stripPrefix}
                disabled={props.busy || form.matchKind !== "path"}
                onCheckedChange={(checked) =>
                  patch({ stripPrefix: checked === true })
                }
              />
              <FieldLabel htmlFor="caddy-rule-strip-prefix">
                剥离路径前缀后转发
              </FieldLabel>
            </div>
            <FieldDescription>
              仅路径匹配可用；域名匹配不写这一项。
            </FieldDescription>
          </Field>

          <Field>
            <div className="flex min-h-11 items-center gap-2">
              <Checkbox
                id="caddy-rule-enabled"
                checked={form.enabled}
                disabled={props.busy}
                onCheckedChange={(checked) =>
                  patch({ enabled: checked === true })
                }
              />
              <FieldLabel htmlFor="caddy-rule-enabled">启用这条规则</FieldLabel>
            </div>
            <FieldDescription>
              停用的规则留在数据库里，但不会写进配置文件。
            </FieldDescription>
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={props.busy}
            onClick={() => props.onOpenChange(false)}
          >
            取消
          </Button>
          <ActionButton
            className="min-h-11"
            busy={props.busy}
            busyLabel="保存中"
            onClick={() => void submit()}
          >
            {props.rule === null ? "新增规则" : "保存修改"}
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
