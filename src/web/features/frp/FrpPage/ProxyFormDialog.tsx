import { useState } from "react"
import { Button } from "@web/components/ui/button"
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
import {
  FRP_PROXY_TYPES,
  type FrpProxy,
  type FrpProxyType,
} from "@shared/api-contract"

type ProxyFormDialogProps = {
  onOpenChange: (open: boolean) => void
  /** 编辑时传入原隧道；新增时为 null。 */
  editing: FrpProxy | null
  /** 已有的隧道名，用于查重。 */
  existingNames: string[]
  onSubmit: (proxy: FrpProxy) => void
}

type FormState = {
  name: string
  type: FrpProxyType
  localIP: string
  localPort: string
  remotePort: string
}

const toForm = (proxy: FrpProxy | null): FormState =>
  proxy
    ? {
        name: proxy.name,
        type: proxy.type,
        localIP: proxy.localIP,
        localPort: String(proxy.localPort),
        remotePort: String(proxy.remotePort),
      }
    : {
        name: "",
        type: "tcp",
        localIP: "127.0.0.1",
        localPort: "",
        remotePort: "",
      }

const parsePort = (text: string): number | null => {
  const value = Number(text)
  if (!Number.isInteger(value) || value < 1 || value > 65535) return null
  return value
}

/** 新增 / 编辑一条隧道。表单字段是页面局部状态，直接用 React state。 */
export const ProxyFormDialog = (props: ProxyFormDialogProps) => {
  const { onOpenChange, editing, existingNames, onSubmit } = props
  const [form, setForm] = useState<FormState>(() => toForm(editing))
  const [error, setError] = useState<string | null>(null)

  const patch = (next: Partial<FormState>) =>
    setForm((previous) => ({ ...previous, ...next }))

  const submit = () => {
    const name = form.name.trim()
    if (!name) return setError("隧道名不能为空")
    if (existingNames.some((item) => item === name && item !== editing?.name)) {
      return setError(`隧道名 ${name} 已存在`)
    }
    if (!form.localIP.trim()) return setError("本地 IP 不能为空")
    const localPort = parsePort(form.localPort)
    if (localPort === null) return setError("本地端口需为 1–65535 的整数")
    const remotePort = parsePort(form.remotePort)
    if (remotePort === null) return setError("远程端口需为 1–65535 的整数")

    onSubmit({
      name,
      type: form.type,
      localIP: form.localIP.trim(),
      localPort,
      remotePort,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "编辑隧道" : "新增隧道"}</DialogTitle>
          <DialogDescription>
            隧道对应 frpc 配置里的一段 [[proxies]]，保存后写入配置文件。
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="frp-name">隧道名</FieldLabel>
            <Input
              id="frp-name"
              value={form.name}
              onChange={(event) => patch({ name: event.target.value })}
              placeholder="mac-xianyu-34082"
            />
          </Field>

          <Field>
            <FieldLabel>类型</FieldLabel>
            <Select
              value={form.type}
              onValueChange={(value) => patch({ type: value as FrpProxyType })}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{(value) => String(value ?? "")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FRP_PROXY_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="frp-local-ip">本地 IP</FieldLabel>
              <Input
                id="frp-local-ip"
                value={form.localIP}
                onChange={(event) => patch({ localIP: event.target.value })}
                placeholder="127.0.0.1"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="frp-local-port">本地端口</FieldLabel>
              <Input
                id="frp-local-port"
                inputMode="numeric"
                value={form.localPort}
                onChange={(event) => patch({ localPort: event.target.value })}
                placeholder="6767"
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="frp-remote-port">远程端口</FieldLabel>
            <Input
              id="frp-remote-port"
              inputMode="numeric"
              value={form.remotePort}
              onChange={(event) => patch({ remotePort: event.target.value })}
              placeholder="34082"
            />
            <FieldDescription>
              公网 serverPort 之外、可对外访问的端口。
            </FieldDescription>
          </Field>
        </FieldGroup>

        {error ? <FieldError>{error}</FieldError> : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit}>{editing ? "保存修改" : "新增"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
