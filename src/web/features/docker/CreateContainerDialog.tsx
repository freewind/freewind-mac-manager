import type {
  DockerContainerCreateBody,
  DockerImage,
} from "@shared/api-contract"
import { ActionButton } from "@web/components/ActionButton"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@web/components/ui/combobox"
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
import { Textarea } from "@web/components/ui/textarea"
import {
  buildCreateBody,
  type CreateFormState,
  emptyCreateForm,
  RESTART_POLICY_LABELS,
} from "@web/features/docker/create-form"
import { Plus, Trash2 } from "lucide-react"
import { useState } from "react"

type CreateContainerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 本地镜像：只作为输入建议，仍允许手输引用。 */
  images: DockerImage[]
  /** 提交中：禁用全部输入与按钮，防重复提交。 */
  busy: boolean
  /** 服务端返回的失败文案（如 409），留在表单里持续展示。 */
  failure: string | null
  onSubmit: (body: DockerContainerCreateBody) => void
}

const rowKey = (index: number, kind: string): string => `${kind}-${index}`

export const CreateContainerDialog = (props: CreateContainerDialogProps) => {
  const [form, setForm] = useState<CreateFormState>(() => emptyCreateForm())
  const [errors, setErrors] = useState<Record<string, string>>({})
  // 只做输入建议：镜像引用仍可手输，列表变化时建议跟着变
  const suggestions = props.images.slice(0, 50)

  const patch = (next: Partial<CreateFormState>): void =>
    setForm((previous) => ({ ...previous, ...next }))

  const submit = (): void => {
    const result = buildCreateBody(form)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    props.onSubmit(result.body)
  }

  const errorOf = (field: string): string | null => errors[field] ?? null

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建容器</DialogTitle>
          <DialogDescription>
            提交后在后台创建并启动；进度与结果在任务中心查看，这里不显示估算进度。
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field data-invalid={errorOf("image") ? true : undefined}>
            <FieldLabel htmlFor="create-image">镜像（必填）</FieldLabel>
            <Input
              id="create-image"
              list="docker-local-images"
              value={form.image}
              autoComplete="off"
              placeholder="例如 alpine:3.20"
              disabled={props.busy}
              onChange={(event) => patch({ image: event.target.value })}
            />
            <datalist id="docker-local-images">
              {suggestions.map((image) => (
                <option
                  key={image.id}
                  value={`${image.repository}:${image.tag}`}
                />
              ))}
            </datalist>
            <FieldDescription>
              只使用本地已有镜像；本地没有时会提示先去镜像分区拉取。
            </FieldDescription>
            {errorOf("image") ? (
              <FieldError>{errorOf("image")}</FieldError>
            ) : null}
          </Field>

          <Field data-invalid={errorOf("name") ? true : undefined}>
            <FieldLabel htmlFor="create-name">容器名（可选）</FieldLabel>
            <Input
              id="create-name"
              value={form.name}
              autoComplete="off"
              placeholder="留空则由 Docker 随机命名"
              disabled={props.busy}
              onChange={(event) => patch({ name: event.target.value })}
            />
            {errorOf("name") ? (
              <FieldError>{errorOf("name")}</FieldError>
            ) : null}
          </Field>

          <Field data-invalid={errorOf("ports") ? true : undefined}>
            <FieldLabel>端口映射</FieldLabel>
            <div className="flex flex-col gap-2">
              {form.ports.map((row, index) => (
                <div
                  key={rowKey(index, "port")}
                  className="flex items-center gap-2"
                >
                  <Input
                    inputMode="numeric"
                    aria-label={`第 ${index + 1} 行宿主机端口`}
                    placeholder="宿主机端口"
                    value={row.hostPort}
                    disabled={props.busy}
                    onChange={(event) => {
                      const ports = [...form.ports]
                      ports[index] = { ...row, hostPort: event.target.value }
                      patch({ ports })
                    }}
                  />
                  <span aria-hidden="true" className="text-muted-foreground">
                    :
                  </span>
                  <Input
                    inputMode="numeric"
                    aria-label={`第 ${index + 1} 行容器端口`}
                    placeholder="容器端口"
                    value={row.containerPort}
                    disabled={props.busy}
                    onChange={(event) => {
                      const ports = [...form.ports]
                      ports[index] = {
                        ...row,
                        containerPort: event.target.value,
                      }
                      patch({ ports })
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0"
                    aria-label={`删除第 ${index + 1} 行端口映射`}
                    disabled={props.busy}
                    onClick={() =>
                      patch({
                        ports: form.ports.filter((_, item) => item !== index),
                      })
                    }
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              className="self-start"
              disabled={props.busy}
              onClick={() =>
                patch({
                  ports: [...form.ports, { hostPort: "", containerPort: "" }],
                })
              }
            >
              <Plus aria-hidden="true" />
              添加端口映射
            </Button>
            {errorOf("ports") ? (
              <FieldError>{errorOf("ports")}</FieldError>
            ) : null}
          </Field>

          <Field data-invalid={errorOf("volumes") ? true : undefined}>
            <FieldLabel>卷挂载</FieldLabel>
            <div className="flex flex-col gap-2">
              {form.volumes.map((row, index) => (
                <div
                  key={rowKey(index, "volume")}
                  className="flex items-center gap-2"
                >
                  <Input
                    aria-label={`第 ${index + 1} 行宿主路径或卷名`}
                    placeholder="宿主路径或卷名"
                    value={row.source}
                    disabled={props.busy}
                    onChange={(event) => {
                      const volumes = [...form.volumes]
                      volumes[index] = { ...row, source: event.target.value }
                      patch({ volumes })
                    }}
                  />
                  <span aria-hidden="true" className="text-muted-foreground">
                    :
                  </span>
                  <Input
                    aria-label={`第 ${index + 1} 行容器内路径`}
                    placeholder="/容器内路径"
                    value={row.destination}
                    disabled={props.busy}
                    onChange={(event) => {
                      const volumes = [...form.volumes]
                      volumes[index] = {
                        ...row,
                        destination: event.target.value,
                      }
                      patch({ volumes })
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0"
                    aria-label={`删除第 ${index + 1} 行卷挂载`}
                    disabled={props.busy}
                    onClick={() =>
                      patch({
                        volumes: form.volumes.filter(
                          (_, item) => item !== index
                        ),
                      })
                    }
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              className="self-start"
              disabled={props.busy}
              onClick={() =>
                patch({
                  volumes: [...form.volumes, { source: "", destination: "" }],
                })
              }
            >
              <Plus aria-hidden="true" />
              添加卷挂载
            </Button>
            {errorOf("volumes") ? (
              <FieldError>{errorOf("volumes")}</FieldError>
            ) : null}
          </Field>

          <Field data-invalid={errorOf("env") ? true : undefined}>
            <FieldLabel>环境变量</FieldLabel>
            <div className="flex flex-col gap-2">
              {form.env.map((row, index) => (
                <div
                  key={rowKey(index, "env")}
                  className="flex items-center gap-2"
                >
                  <Input
                    aria-label={`第 ${index + 1} 行变量名`}
                    placeholder="变量名"
                    value={row.name}
                    disabled={props.busy}
                    onChange={(event) => {
                      const env = [...form.env]
                      env[index] = { ...row, name: event.target.value }
                      patch({ env })
                    }}
                  />
                  <Input
                    aria-label={`第 ${index + 1} 行变量值`}
                    placeholder="变量值"
                    value={row.value}
                    disabled={props.busy}
                    onChange={(event) => {
                      const env = [...form.env]
                      env[index] = { ...row, value: event.target.value }
                      patch({ env })
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0"
                    aria-label={`删除第 ${index + 1} 行环境变量`}
                    disabled={props.busy}
                    onClick={() =>
                      patch({
                        env: form.env.filter((_, item) => item !== index),
                      })
                    }
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              className="self-start"
              disabled={props.busy}
              onClick={() =>
                patch({ env: [...form.env, { name: "", value: "" }] })
              }
            >
              <Plus aria-hidden="true" />
              添加环境变量
            </Button>
            {errorOf("env") ? <FieldError>{errorOf("env")}</FieldError> : null}
          </Field>

          <Field>
            <FieldLabel htmlFor="create-restart">重启策略</FieldLabel>
            <Combobox
              items={Object.entries(RESTART_POLICY_LABELS).map(
                ([value, label]) => ({ value, label })
              )}
              itemToStringValue={(item: { value: string; label: string }) =>
                item.value
              }
              value={
                form.restartPolicy &&
                form.restartPolicy in RESTART_POLICY_LABELS
                  ? {
                      value: form.restartPolicy,
                      label: RESTART_POLICY_LABELS[form.restartPolicy],
                    }
                  : null
              }
              disabled={props.busy}
              onValueChange={(value) =>
                patch({
                  restartPolicy: (
                    value as { value: string; label: string } | null
                  )?.value as DockerContainerCreateBody["restartPolicy"],
                })
              }
            >
              <ComboboxInput id="create-restart" className="w-full" />
              <ComboboxContent>
                <ComboboxEmpty>无匹配项</ComboboxEmpty>
                <ComboboxList>
                  {(item: { value: string; label: string }) => (
                    <ComboboxItem key={item.value} value={item}>
                      {item.label}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </Field>

          <Field>
            <FieldLabel htmlFor="create-command">
              覆盖启动命令（可选，每行一个参数）
            </FieldLabel>
            <Textarea
              id="create-command"
              value={form.command}
              rows={4}
              disabled={props.busy}
              placeholder={"redis-server\n--appendonly\nyes"}
              onChange={(event) => patch({ command: event.target.value })}
            />
            <FieldDescription>
              每行是一个完整参数，不会被空格切开；留空则使用镜像自带的启动命令。
            </FieldDescription>
          </Field>
        </FieldGroup>

        {props.failure ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>新建容器没有完成</AlertTitle>
            <AlertDescription>{props.failure}</AlertDescription>
          </Alert>
        ) : null}

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
            busyLabel="正在提交…"
            onClick={submit}
          >
            创建并启动
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
