import type { DockerContainerCreateBody } from "@shared/api-contract"

/** 与后端契约一致的字符规则。 */
const IMAGE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/
const CONTAINER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export type PortRow = { hostPort: string; containerPort: string }
export type VolumeRow = { source: string; destination: string }
export type EnvRow = { name: string; value: string }

export type CreateFormState = {
  image: string
  name: string
  ports: PortRow[]
  volumes: VolumeRow[]
  env: EnvRow[]
  restartPolicy: DockerContainerCreateBody["restartPolicy"]
  /** 每行一个参数：不做空格分词，避免带空格的参数被拆错 */
  command: string
}

export const emptyCreateForm = (): CreateFormState => ({
  image: "",
  name: "",
  ports: [{ hostPort: "", containerPort: "" }],
  volumes: [{ source: "", destination: "" }],
  env: [{ name: "", value: "" }],
  restartPolicy: "no",
  command: "",
})

export const RESTART_POLICY_LABELS: Record<
  NonNullable<DockerContainerCreateBody["restartPolicy"]>,
  string
> = {
  no: "不自动重启",
  always: "总是重启",
  "unless-stopped": "除非手动停止",
  "on-failure": "失败时重启",
}

export type CreateFormResult =
  | { ok: true; body: DockerContainerCreateBody }
  | { ok: false; errors: Record<string, string> }

/** 每行一个参数：空行忽略，其余原样作为 argv 元素（含空格也不拆）。 */
export const commandArgvOf = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

const parsePort = (text: string): number | null => {
  const value = Number(text)
  if (!Number.isInteger(value) || value < 1 || value > 65535) return null
  return value
}

/** 表单校验与载荷组装：校验失败时逐字段给出可读提示。 */
export const buildCreateBody = (form: CreateFormState): CreateFormResult => {
  const errors: Record<string, string> = {}
  const image = form.image.trim()
  const name = form.name.trim()

  if (image.length === 0) errors.image = "请填写镜像地址"
  else if (!IMAGE_REFERENCE_PATTERN.test(image))
    errors.image = "镜像地址格式不合法"

  if (name.length > 0 && !CONTAINER_NAME_PATTERN.test(name)) {
    errors.name =
      "容器名只能包含字母、数字、点、下划线与连字符，且不能以连字符开头"
  }

  const ports: NonNullable<DockerContainerCreateBody["ports"]> = []
  for (const row of form.ports) {
    const host = row.hostPort.trim()
    const container = row.containerPort.trim()
    if (host.length === 0 && container.length === 0) continue
    const hostPort = parsePort(host)
    const containerPort = parsePort(container)
    if (hostPort === null || containerPort === null) {
      errors.ports = "端口必须是 1–65535 的整数，且成对填写"
      break
    }
    ports.push({ hostPort, containerPort, protocol: "tcp" })
  }

  const volumes: NonNullable<DockerContainerCreateBody["volumes"]> = []
  for (const row of form.volumes) {
    const source = row.source.trim()
    const destination = row.destination.trim()
    if (source.length === 0 && destination.length === 0) continue
    if (source.length === 0) {
      errors.volumes = "请填写宿主机路径或卷名"
      break
    }
    if (!destination.startsWith("/")) {
      errors.volumes = "容器内路径必须是绝对路径（以 / 开头）"
      break
    }
    volumes.push({ source, destination })
  }

  const env: NonNullable<DockerContainerCreateBody["env"]> = []
  for (const row of form.env) {
    const key = row.name.trim()
    if (key.length === 0 && row.value.length === 0) continue
    if (!ENV_NAME_PATTERN.test(key)) {
      errors.env = "变量名只能包含字母、数字与下划线，且不能以数字开头"
      break
    }
    env.push({ name: key, value: row.value })
  }

  const command = commandArgvOf(form.command)

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return {
    ok: true,
    body: {
      image,
      ...(name.length > 0 ? { name } : {}),
      ...(ports.length > 0 ? { ports } : {}),
      ...(volumes.length > 0 ? { volumes } : {}),
      ...(env.length > 0 ? { env } : {}),
      restartPolicy: form.restartPolicy,
      ...(command.length > 0 ? { command } : {}),
    },
  }
}
