import { execFile } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { cached } from "@server/common/collect"
import {
  DOCKER_CONTAINER_STATES,
  type DockerColimaStatus,
  type DockerContainer,
  type DockerContainerCreateBody,
  type DockerContainerLogsResponse,
  type DockerImage,
  type DockerMount,
  type DockerNetwork,
  type DockerPortMapping,
  type DockerVolume,
} from "@shared/api-contract"

/** 单条命令的输出上限，避免异常输出把内存撑爆。 */
const MAX_BUFFER = 8 * 1024 * 1024

const TIMEOUT = {
  /** version 这类极轻的命令 */
  quick: 15_000,
  /** 列表查询：容器多时 ps -a 会慢一些 */
  list: 30_000,
  logs: 30_000,
  /** 容器启停、删除、创建等写命令 */
  write: 120_000,
  /** 拉取镜像可能很慢 */
  pull: 600_000,
  /** colima start 要拉虚拟机，给足时间（页面侧仍按长任务处理） */
  colimaStart: 300_000,
  colimaStop: 120_000,
} as const

/** 只读列表的短 TTL：页面几秒刷新一次，缓存只为避免重复压机器。 */
const TTL = {
  containers: 3_000,
  images: 10_000,
  volumes: 10_000,
  networks: 10_000,
  info: 10_000,
  version: 60_000,
} as const

export type DockerErrorKind =
  | "not_installed"
  /** 资源被占用（如镜像仍被容器使用），需要显式 force 或先解除引用 */
  | "conflict"
  | "daemon_unavailable"
  | "timeout"
  | "invalid_input"
  | "failed"

/**
 * docker/colima 调用的统一错误：带上可判定的种类与中文说明。
 * handler 按 kind 决定 HTTP 状态，不再解析原始 stderr。
 */
export class DockerCommandError extends Error {
  readonly kind: DockerErrorKind
  /** 原始错误文本（stderr 摘要），用于排查与二次判定。 */
  readonly detail: string

  constructor(kind: DockerErrorKind, message: string, detail = "") {
    super(message)
    this.name = "DockerCommandError"
    this.kind = kind
    this.detail = detail
  }
}

export type CommandOutput = { stdout: string; stderr: string }

export type CommandOptions = {
  timeoutMs: number
  /** 流式输出回调：只有长命令（pull）需要，用来驱动真实进度。 */
  onOutput?: (chunk: string) => void
}

export type DockerCommandRunner = (
  command: string,
  args: string[],
  options: CommandOptions
) => Promise<CommandOutput>

export type DockerCache = <T>(
  key: string,
  ttl: number,
  load: () => Promise<T>
) => Promise<T>

/**
 * 默认执行器：参数一律走数组传给 execFile，绝不经过 shell，
 * 因此不存在拼接注入；这里只负责把 Node 的错误原样抛出并附上 stderr，
 * 中文错误映射统一由 cli 层做，便于用受控替身测试。
 */
export const execCommand: DockerCommandRunner = (
  command,
  args,
  { timeoutMs, onOutput }
) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      { maxBuffer: MAX_BUFFER, timeout: timeoutMs, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stderr }))
          return
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "" })
      }
    )
    if (onOutput) {
      // 进度看流式输出；execFile 回调仍在结束时给完整输出，两者互不影响
      const emit = (chunk: string): void => onOutput(chunk)
      child.stdout?.on("data", emit)
      child.stderr?.on("data", emit)
    }
  })

const HOME_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"]

/**
 * 可执行文件优先用 PATH 里的名字；服务由 launchd 拉起时 PATH 往往很短，
 * 所以 PATH 找不到时再补几个常见安装目录（Homebrew 与 docker CLI 插件目录）。
 */
const commandCandidates = (command: string): string[] => [
  command,
  ...HOME_BIN_DIRS.map((dir) => path.join(dir, command)),
  path.join(os.homedir(), ".docker", "bin", command),
]

const firstMeaningfulLine = (text: string): string | null => {
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (line.length === 0) continue
    if (/^Command failed:/i.test(line)) continue
    return line
  }
  return null
}

const NOT_INSTALLED_MESSAGE: Record<string, string> = {
  docker: "未找到 docker 命令，请确认 Docker 或 Colima 已安装。",
  colima: "未找到 colima 命令，请先安装 Colima。",
}

/** 把 Node 的 execFile 错误翻译成可判定的中文错误。 */
export const toCommandError = (
  command: string,
  error: unknown,
  timeoutMs: number
): DockerCommandError => {
  if (error instanceof DockerCommandError) return error
  const label = path.basename(command)
  const record = (error ?? {}) as {
    code?: unknown
    killed?: unknown
    signal?: unknown
    message?: unknown
    stderr?: unknown
  }
  const stderr = typeof record.stderr === "string" ? record.stderr : ""
  const detail = (stderr || String(record.message ?? "")).trim()

  if (record.code === "ENOENT") {
    return new DockerCommandError(
      "not_installed",
      NOT_INSTALLED_MESSAGE[label] ?? `未找到 ${label} 命令，请确认已安装。`,
      detail
    )
  }
  if (record.killed || record.signal) {
    return new DockerCommandError(
      "timeout",
      `${label} 命令执行超时（超过 ${Math.round(timeoutMs / 1000)} 秒），已终止。`,
      detail
    )
  }
  if (
    label === "docker" &&
    /cannot connect to the docker daemon|is the docker daemon running|error during connect/i.test(
      detail
    )
  ) {
    return new DockerCommandError(
      "daemon_unavailable",
      "Docker 服务未运行，请先启动 Docker 或执行 colima start。",
      detail
    )
  }
  if (
    /image is being used by|must be forced|conflict: unable to delete/i.test(
      detail
    )
  ) {
    return new DockerCommandError(
      "conflict",
      "该镜像被容器使用中，请先删除相关容器，或显式选择强制删除",
      detail
    )
  }
  const summary = firstMeaningfulLine(detail) ?? "未知原因"
  return new DockerCommandError(
    "failed",
    `${label} 命令执行失败：${summary}`,
    detail
  )
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {}

const asText = (value: unknown): string =>
  typeof value === "string" ? value : value == null ? "" : String(value)

const asNumber = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const parseJsonValue = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * docker 的 --format json 是「每行一个 JSON 对象」，不是 JSON 数组，
 * 因此按行解析；坏行跳过而不是让整次读取失败。
 */
export const parseJsonLines = (text: string): unknown[] => {
  const values: unknown[] = []
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line.startsWith("{")) continue
    const value = parseJsonValue(line)
    if (value !== null) values.push(value)
  }
  return values
}

const SIZE_UNITS: Record<string, number> = {
  B: 1,
  KB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
  TB: 1000 ** 4,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3,
  TIB: 1024 ** 4,
}

/** "187MB" → 字节数；"N/A" 或无法识别时返回 null。 */
export const parseDockerSize = (text: string): number | null => {
  const match = /^([\d.]+)\s*([A-Za-z]+)$/.exec(text.trim())
  if (!match) return null
  const unit = SIZE_UNITS[(match[2] ?? "").toUpperCase()]
  const value = Number(match[1])
  if (!unit || !Number.isFinite(value)) return null
  return Math.round(value * unit)
}

/**
 * docker 的时间形如 "2024-01-01 12:00:00 +0800 CST"，
 * 去掉时区名、把空格换成 T 后才能稳定解析；失败返回 null。
 */
export const parseDockerTime = (text: string): number | null => {
  const trimmed = text.trim().replace(/\s+[A-Za-z]{2,6}$/, "")
  if (trimmed.length === 0) return null
  const iso = trimmed
    .replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T")
    .replace(/ ([+-]\d{4})$/, "$1")
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed : null
}

const parseProtocol = (value: string): "tcp" | "udp" =>
  value.trim().toLowerCase() === "udp" ? "udp" : "tcp"

/** Go 的零值时间：未启动过的容器 StartedAt 就是这个值，必须当作缺值。 */
const ZERO_TIME = /^0001-01-01T00:00:00(\.\d+)?Z$/i

/** 解析 inspect 的 RFC3339 时间（如 "2026-10-11T07:25:40.887230468Z"）。 */
export const parseRfc3339Time = (text: string): number | null => {
  const trimmed = text.trim()
  if (trimmed.length === 0 || ZERO_TIME.test(trimmed)) return null
  const parsed = Date.parse(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * 解析 inspect 的 NetworkSettings.Ports，形如
 * `{"8000/tcp":[{"HostIp":"127.0.0.1","HostPort":"48000"}]}`。
 * 值为 null 表示只声明未发布，不产生映射。
 */
export const parseInspectPorts = (ports: unknown): DockerPortMapping[] => {
  const mappings: DockerPortMapping[] = []
  for (const [key, value] of Object.entries(asRecord(ports))) {
    if (!Array.isArray(value)) continue
    const slash = key.lastIndexOf("/")
    const containerPort = asNumber(slash >= 0 ? key.slice(0, slash) : key)
    if (containerPort <= 0) continue
    const protocol = parseProtocol(slash >= 0 ? key.slice(slash + 1) : "tcp")
    for (const binding of value) {
      const item = asRecord(binding)
      const rawHostPort = asText(item.HostPort)
      const hostPort = Number(rawHostPort)
      mappings.push({
        hostIp: asText(item.HostIp),
        hostPort:
          rawHostPort.length > 0 && Number.isFinite(hostPort) ? hostPort : null,
        containerPort,
        protocol,
      })
    }
  }
  return mappings
}

/**
 * 解析 inspect 的 Mounts；RW 为 false 表示只读挂载。
 * ps 的 Mounts 字段会被 docker 按列宽截断，所以一律以 inspect 为准。
 */
export const parseInspectMounts = (mounts: unknown): DockerMount[] => {
  if (!Array.isArray(mounts)) return []
  const result: DockerMount[] = []
  for (const raw of mounts) {
    const item = asRecord(raw)
    const type = asText(item.Type)
    if (type !== "bind" && type !== "volume" && type !== "tmpfs") continue
    const destination = asText(item.Destination)
    if (destination.length === 0) continue
    result.push({
      type,
      source: asText(item.Source),
      destination,
      readOnly: item.RW === false,
    })
  }
  return result
}

const parseContainerState = (value: string): DockerContainer["state"] => {
  const state = value.trim().toLowerCase()
  const states: readonly string[] = DOCKER_CONTAINER_STATES
  return states.includes(state) ? (state as DockerContainer["state"]) : "exited"
}

const splitList = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

/** ps 的输出只用来补 Status 文本与名称，结构化字段全部来自 inspect。 */
export type PsContainerSummary = {
  id: string
  name: string
  status: string
}

/** ps -a --format json：Status 是 "Up 33 minutes (healthy)" 这类可读文本。 */
export const parsePsSummaries = (text: string): PsContainerSummary[] =>
  parseJsonLines(text).map((line) => {
    const item = asRecord(line)
    return {
      id: asText(item.ID),
      name: asText(item.Names),
      status: asText(item.Status),
    }
  })

const CONTAINER_ID_PATTERN = /^[0-9a-f]{12,64}$/i

/** ps -aq 的 id 列表：只接受十六进制 id，异常行丢弃。 */
export const parseContainerIds = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => CONTAINER_ID_PATTERN.test(line))

/** inspect 里我们真正要用的字段。 */
export type InspectedContainer = {
  id: string
  name: string
  image: string
  command: string
  state: DockerContainer["state"]
  createdAt: number | null
  startedAt: number | null
  ports: DockerPortMapping[]
  mounts: DockerMount[]
}

/** 解析 docker inspect 的 JSON 数组，取出结构化字段。 */
export const parseInspectedContainers = (
  text: string
): InspectedContainer[] => {
  const value = parseJsonValue(text)
  if (!Array.isArray(value)) return []
  return value.map((raw) => {
    const item = asRecord(raw)
    const state = asRecord(item.State)
    const config = asRecord(item.Config)
    const cmd = Array.isArray(config.Cmd) ? config.Cmd.map(asText) : []
    const args = Array.isArray(item.Args) ? item.Args.map(asText) : []
    const command = (cmd.length > 0 ? cmd : [asText(item.Path), ...args])
      .filter((part) => part.length > 0)
      .join(" ")
    return {
      id: asText(item.Id),
      name: asText(item.Name).replace(/^\//, ""),
      image: asText(config.Image),
      command,
      state: parseContainerState(asText(state.Status)),
      createdAt: parseRfc3339Time(asText(item.Created)),
      startedAt: parseRfc3339Time(asText(state.StartedAt)),
      ports: parseInspectPorts(asRecord(item.NetworkSettings).Ports),
      mounts: parseInspectMounts(item.Mounts),
    }
  })
}

/**
 * 合并 inspect（结构化）与 ps（Status 文本、名称兜底）。
 * ps 给的是短 id，inspect 给完整 id，所以按前缀匹配。
 */
export const mergeContainers = (
  inspected: InspectedContainer[],
  summaries: PsContainerSummary[]
): DockerContainer[] =>
  inspected.map((item) => {
    const summary =
      summaries.find(
        (candidate) =>
          candidate.id === item.id ||
          item.id.startsWith(candidate.id) ||
          candidate.id.startsWith(item.id)
      ) ?? null
    return {
      id: item.id,
      name: summary?.name || item.name,
      image: item.image,
      command: item.command,
      state: item.state,
      status: summary?.status ?? "",
      createdAt: item.createdAt ?? 0,
      startedAt: item.startedAt,
      ports: item.ports,
      mounts: item.mounts,
    }
  })

/** 容器所属网络名（供网络列表统计接入数），来自 ps 的 Networks 字段。 */
const parseContainerNetworks = (text: string): string[][] =>
  parseJsonLines(text).map((line) => splitList(asText(asRecord(line).Networks)))

/** 解析 images 的 json 行；"N/A" 的字段按 0/默认值处理。 */
export const parseImages = (text: string): DockerImage[] =>
  parseJsonLines(text).map((line) => {
    const item = asRecord(line)
    return {
      id: asText(item.ID),
      repository: asText(item.Repository) || "<none>",
      tag: asText(item.Tag) || "<none>",
      sizeBytes: parseDockerSize(asText(item.Size)) ?? 0,
      createdAt: parseDockerTime(asText(item.CreatedAt)) ?? 0,
      containers: asNumber(item.Containers),
    }
  })

/** 解析 network ls 的 json 行；接入容器数要靠容器列表交叉统计，这里先置 0。 */
export const parseNetworks = (text: string): DockerNetwork[] =>
  parseJsonLines(text).map((line) => {
    const item = asRecord(line)
    return {
      id: asText(item.ID),
      name: asText(item.Name),
      driver: asText(item.Driver),
      scope: asText(item.Scope),
      internal: asText(item.Internal).toLowerCase() === "true",
      containers: 0,
    }
  })

/** ps 与 network ls 都不给容器名，只有 volume inspect 能给挂载点。 */
const parseVolumeInspections = (
  text: string
): Map<
  string,
  { mountpoint: string; createdAt: number | null; driver: string }
> => {
  const value = parseJsonValue(text)
  const map = new Map<
    string,
    { mountpoint: string; createdAt: number | null; driver: string }
  >()
  if (!Array.isArray(value)) return map
  for (const item of value) {
    const record = asRecord(item)
    const name = asText(record.Name)
    if (name.length === 0) continue
    map.set(name, {
      mountpoint: asText(record.Mountpoint),
      createdAt: parseDockerTime(asText(record.CreatedAt)),
      driver: asText(record.Driver),
    })
  }
  return map
}

/**
 * 解析 `docker system df -v` 的 Local Volumes 段：
 * volume ls 的 Size 是 "N/A"，真值只在这张表的 VOLUME NAME/SIZE 列里。
 */
export const parseVolumeSizes = (text: string): Map<string, number> => {
  const sizes = new Map<string, number>()
  let inVolumes = false
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd()
    const trimmed = line.trim()
    if (/^VOLUME NAME\b/.test(trimmed)) {
      inVolumes = true
      continue
    }
    if (!inVolumes) continue
    // 空行或下一个段落开头就是这段结束
    if (trimmed.length === 0 || /^\S+ space usage:/.test(trimmed)) {
      inVolumes = false
      continue
    }
    if (/^Build cache/.test(trimmed)) {
      inVolumes = false
      continue
    }
    // 表格列之间是两个以上空格
    const columns = trimmed.split(/\s{2,}/)
    if (columns.length < 3) continue
    const name = columns[0] ?? ""
    const size = parseDockerSize(columns[columns.length - 1] ?? "")
    if (name.length === 0 || size === null) continue
    sizes.set(name, size)
  }
  return sizes
}

/** 解析 `docker system df` 的 TYPE/SIZE 列（Images 的 SIZE 已去重共享层）。 */
export const parseDiskUsage = (text: string): Map<string, number> => {
  const usage = new Map<string, number>()
  for (const raw of text.split("\n")) {
    const columns = raw.trim().split(/\s{2,}/)
    if (columns.length < 4) continue
    const type = (columns[0] ?? "").trim()
    const size = parseDockerSize(columns[3] ?? "")
    if (type.length === 0 || size === null) continue
    usage.set(type, size)
  }
  return usage
}

/** 卷名在 docker 里只能是 [A-Za-z0-9][A-Za-z0-9_.-]*，过滤掉异常值再拼参数。 */
const isValidVolumeName = (name: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)

/** 一次 inspect 的卷数上限，避免单条命令参数过长；超出时分批继续。 */
const VOLUME_INSPECT_CHUNK = 200

export type DockerInfo = {
  serverVersion: string
  containersTotal: number
  containersRunning: number
  containersPaused: number
  containersStopped: number
  imagesTotal: number
}

export const parseInfo = (text: string): DockerInfo => {
  const item = asRecord(parseJsonValue(text))
  return {
    serverVersion: asText(item.ServerVersion),
    containersTotal: asNumber(item.Containers),
    containersRunning: asNumber(item.ContainersRunning),
    containersPaused: asNumber(item.ContainersPaused),
    containersStopped: asNumber(item.ContainersStopped),
    imagesTotal: asNumber(item.Images),
  }
}

export const parseVersion = (text: string): string => {
  const item = asRecord(parseJsonValue(text))
  const server = asText(asRecord(item.Server).Version)
  return server || asText(asRecord(item.Client).Version)
}

/**
 * colima status 的输出是几行日志（logrus 写法 `msg="arch: x86_64"`）。
 * 停止状态各版本措辞不同，统一按「不处于 running」处理；取值要去掉行尾引号。
 */
export const parseColimaStatus = (
  text: string
): { running: boolean; runtime: string | null; arch: string | null } => {
  const running = /colima is running/i.test(text)
  const field = (name: string): string | null =>
    new RegExp(`${name}:\\s*([^"\\s\\\\]+)`).exec(text)?.[1] ?? null
  return {
    running,
    runtime: field("runtime"),
    arch: field("arch"),
  }
}

/** colima 明确「没在运行」时的措辞，属于正常状态而非故障。 */
const COLIMA_STOPPED_PATTERN =
  /colima is not running|no instance found|not running/i

/** 容器在取 id 与 inspect 之间被删掉时，docker 会报这个。 */
export const isMissingContainerError = (error: unknown): boolean =>
  error instanceof DockerCommandError &&
  error.kind === "failed" &&
  /no such (container|object)/i.test(error.detail)

export type DockerCli = ReturnType<typeof createDockerCli>

/**
 * docker/colima 执行层。run 与 cache 都可注入：
 * 测试用受控替身，不真的调 docker，也不共享全局缓存。
 */
/** 镜像引用/镜像 id：首字符必须是字母数字，挡住以 - 开头的参数注入。 */
const IMAGE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/

/** 环境变量名只能是标识符，避免拼出 abc=1=2 这类歧义参数。 */
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

const assertImageReference = (image: string): void => {
  if (!IMAGE_REFERENCE_PATTERN.test(image)) {
    throw new DockerCommandError(
      "invalid_input",
      "镜像引用包含非法字符，请重新读取镜像列表。"
    )
  }
}

const assertVolumeName = (name: string): void => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) {
    throw new DockerCommandError(
      "invalid_input",
      "卷名包含非法字符，请重新读取卷列表。"
    )
  }
}

const assertNetworkId = (networkId: string): void => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(networkId)) {
    throw new DockerCommandError(
      "invalid_input",
      "网络标识包含非法字符，请重新读取网络列表。"
    )
  }
}

/** 容器名的字符集与契约一致，首字符不能是连字符。 */
const assertContainerName = (name: string): void => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) {
    throw new DockerCommandError(
      "invalid_input",
      "容器名包含非法字符，请重新填写。"
    )
  }
}

/**
 * 把受校验的新建配置逐字段映射成固定 flag，绝不透传任意 docker 参数。
 * 镜像名之后的所有参数都是容器自己的命令，不再交给 docker 解析。
 */
export const containerCreateArgs = (
  config: DockerContainerCreateBody
): string[] => {
  const args = ["run", "--detach"]
  if (config.name !== undefined) {
    assertContainerName(config.name)
    args.push("--name", config.name)
  }
  for (const item of config.env ?? []) {
    if (!ENV_NAME_PATTERN.test(item.name)) {
      throw new DockerCommandError(
        "invalid_input",
        "环境变量名包含非法字符，请重新填写。"
      )
    }
    args.push("--env", `${item.name}=${item.value}`)
  }
  for (const port of config.ports ?? []) {
    args.push(
      "--publish",
      `${port.hostPort}:${port.containerPort}/${port.protocol}`
    )
  }
  for (const mount of config.volumes ?? []) {
    // 容器内挂载点必须是绝对路径，顺带挡住以 - 开头的取值
    if (!mount.destination.startsWith("/")) {
      throw new DockerCommandError(
        "invalid_input",
        "容器内挂载点必须是绝对路径，请重新填写。"
      )
    }
    args.push("--volume", `${mount.source}:${mount.destination}`)
  }
  if (config.restartPolicy !== undefined) {
    args.push("--restart", config.restartPolicy)
  }
  assertImageReference(config.image)
  args.push(config.image)
  for (const part of config.command ?? []) args.push(part)
  return args
}

/**
 * 把流式输出切成整行：docker 的进度条在同一行用 \r 回写，\n 与 \r 都算换行，
 * 两种都要处理，否则进度会黏成一行。
 */
export const createLineSplitter = (onLine: (line: string) => void) => {
  let buffer = ""
  const emit = (text: string): void => {
    const line = text.trim()
    if (line.length > 0) onLine(line)
  }
  return {
    push: (chunk: string): void => {
      buffer += chunk
      const parts = buffer.split(/\r\n|\r|\n/)
      buffer = parts.pop() ?? ""
      for (const part of parts) emit(part)
    },
    flush: (): void => {
      const rest = buffer
      buffer = ""
      emit(rest)
    },
  }
}

/** 拉取进度：层数与字节全部来自 docker 的真实输出，解析不到就是 null。 */
export type PullProgress = {
  /** 输出里出现过的层数 */
  layers: number
  /** 已完成层数（Pull complete / Download complete / Already exists 按层各计一次） */
  completed: number
  bytesDone: number | null
  bytesTotal: number | null
}

const PULL_LAYER_LINE = /^([0-9a-f]{7,64})[:：]\s*(.+)$/i
const PULL_COMPLETED = /^(pull complete|download complete|already exists)/i
const PULL_BYTES = /([\d.]+\s*[A-Za-z]+)\s*\/\s*([\d.]+\s*[A-Za-z]+)/

type LayerProgress = {
  completed: boolean
  bytesDone: number | null
  bytesTotal: number | null
}

/**
 * 逐行累积拉取进度。同一层可能在 Download complete 之后又有 Pull complete，
 * 因此按层去重，done 只增不减，也不会超过层数。
 */
export const createPullProgressTracker = () => {
  const layers = new Map<string, LayerProgress>()
  const snapshot = (): PullProgress => {
    let bytesDone: number | null = null
    let bytesTotal: number | null = null
    let completed = 0
    for (const layer of layers.values()) {
      if (layer.completed) completed += 1
      if (layer.bytesDone !== null)
        bytesDone = (bytesDone ?? 0) + layer.bytesDone
      if (layer.bytesTotal !== null) {
        bytesTotal = (bytesTotal ?? 0) + layer.bytesTotal
      }
    }
    return { layers: layers.size, completed, bytesDone, bytesTotal }
  }
  return {
    /** 返回新进度；这行没带来变化时返回 null，避免刷屏式上报。 */
    push: (line: string): PullProgress | null => {
      const match = PULL_LAYER_LINE.exec(line)
      if (!match) return null
      const id = (match[1] ?? "").toLowerCase()
      const rest = (match[2] ?? "").trim()
      const previous = layers.get(id)
      const layer: LayerProgress = previous ?? {
        completed: false,
        bytesDone: null,
        bytesTotal: null,
      }
      let changed = previous === undefined
      if (PULL_COMPLETED.test(rest)) {
        if (!layer.completed) {
          layer.completed = true
          changed = true
        }
      } else {
        const bytes = PULL_BYTES.exec(rest)
        if (bytes) {
          const done = parseDockerSize(bytes[1] ?? "")
          const total = parseDockerSize(bytes[2] ?? "")
          if (done !== null && done !== layer.bytesDone) {
            layer.bytesDone = done
            changed = true
          }
          if (total !== null && total !== layer.bytesTotal) {
            layer.bytesTotal = total
            changed = true
          }
        }
      }
      layers.set(id, layer)
      return changed ? snapshot() : null
    },
    snapshot,
  }
}

export const createDockerCli = (
  options: { run?: DockerCommandRunner; cache?: DockerCache } = {}
) => {
  const run = options.run ?? execCommand
  const cache = options.cache ?? cached

  /** 依次尝试 PATH 与常见安装目录；只有全部 ENOENT 才判定未安装。 */
  const runCommand = async (
    command: string,
    args: string[],
    timeoutMs: number,
    onOutput?: (chunk: string) => void
  ): Promise<CommandOutput> => {
    const candidates = commandCandidates(command)
    let lastError: unknown = null
    for (const candidate of candidates) {
      try {
        return await run(candidate, args, { timeoutMs, onOutput })
      } catch (error) {
        lastError = error
        if (error instanceof DockerCommandError) {
          if (error.kind !== "not_installed") throw error
        } else if ((error as { code?: unknown } | null)?.code !== "ENOENT") {
          throw toCommandError(candidate, error, timeoutMs)
        }
      }
    }
    throw toCommandError(candidates[0] ?? command, lastError, timeoutMs)
  }

  const docker = (
    args: string[],
    timeoutMs: number,
    onOutput?: (chunk: string) => void
  ): Promise<CommandOutput> => runCommand("docker", args, timeoutMs, onOutput)

  const colima = (args: string[], timeoutMs: number): Promise<CommandOutput> =>
    runCommand("colima", args, timeoutMs)

  const containers = (): Promise<CommandOutput> =>
    docker(["ps", "-a", "--format", "json"], TIMEOUT.list)

  /**
   * ps 的 Mounts 与 Command 会被 docker 按列宽截断，所以结构化数据全靠 inspect；
   * ps 只贡献 Status 文本与名称。
   */
  const inspectContainers = async (
    ids: string[]
  ): Promise<InspectedContainer[]> => {
    const inspect = async (batch: string[]): Promise<InspectedContainer[]> =>
      parseInspectedContainers(
        (await docker(["inspect", ...batch], TIMEOUT.list)).stdout
      )
    if (ids.length === 0) return []
    try {
      return await inspect(ids)
    } catch (error) {
      // 取列表与 inspect 之间容器可能已被删掉：只跳过那一个，其余照常读。
      if (!isMissingContainerError(error)) throw error
      if (ids.length === 1) return []
      const found: InspectedContainer[] = []
      for (const id of ids) {
        try {
          found.push(...(await inspect([id])))
        } catch (inner) {
          if (!isMissingContainerError(inner)) throw inner
        }
      }
      return found
    }
  }

  /** 容器标识会被拼进参数，先挡住非法值，避免被当成 docker 的选项。 */
  const assertContainerId = (containerId: string): void => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(containerId)) {
      throw new DockerCommandError(
        "invalid_input",
        "容器标识包含非法字符，请重新读取容器列表。"
      )
    }
  }

  const listContainers = (): Promise<DockerContainer[]> =>
    cache("docker:containers", TTL.containers, async () => {
      const [ids, listed] = await Promise.all([
        docker(["ps", "-aq"], TIMEOUT.list),
        containers(),
      ])
      const inspected = await inspectContainers(parseContainerIds(ids.stdout))
      return mergeContainers(inspected, parsePsSummaries(listed.stdout))
    })

  const listImages = (): Promise<DockerImage[]> =>
    cache("docker:images", TTL.images, async () =>
      parseImages(
        (await docker(["images", "--format", "json"], TIMEOUT.list)).stdout
      )
    )

  const listNetworks = (): Promise<DockerNetwork[]> =>
    cache("docker:networks", TTL.networks, async () => {
      const [listed, rawContainers] = await Promise.all([
        docker(["network", "ls", "--format", "json"], TIMEOUT.list),
        containers(),
      ])
      const counts = new Map<string, number>()
      for (const names of parseContainerNetworks(rawContainers.stdout)) {
        for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
      }
      return parseNetworks(listed.stdout).map((network) => ({
        ...network,
        containers: counts.get(network.name) ?? counts.get(network.id) ?? 0,
      }))
    })

  const listVolumes = (): Promise<DockerVolume[]> =>
    cache("docker:volumes", TTL.volumes, async () => {
      const listed = await docker(
        ["volume", "ls", "--format", "json"],
        TIMEOUT.list
      )
      const entries = parseJsonLines(listed.stdout).map(asRecord)
      const names = entries
        .map((item) => asText(item.Name))
        .filter(isValidVolumeName)
      const inspected = new Map<
        string,
        { mountpoint: string; createdAt: number | null; driver: string }
      >()
      // 卷多时分批 inspect，保证每个卷都有挂载点信息而不是被悄悄丢掉。
      for (let index = 0; index < names.length; index += VOLUME_INSPECT_CHUNK) {
        const chunk = names.slice(index, index + VOLUME_INSPECT_CHUNK)
        const result = await docker(
          ["volume", "inspect", ...chunk],
          TIMEOUT.list
        )
        for (const [name, detail] of parseVolumeInspections(result.stdout)) {
          inspected.set(name, detail)
        }
      }
      const used = new Set<string>()
      for (const container of await listContainers().catch(() => [])) {
        for (const mount of container.mounts) {
          if (mount.type !== "volume") continue
          used.add(mount.source)
          // inspect 给的是宿主机路径 .../volumes/<name>/_data，两种写法都认得
          const trimmed = mount.source.replace(/\/_data$/, "")
          used.add(trimmed.slice(trimmed.lastIndexOf("/") + 1))
        }
      }
      // 卷大小只有 system df -v 有真值，读不到就保持 null，不影响列表本身。
      const sizes = await docker(["system", "df", "-v"], TIMEOUT.list)
        .then((result) => parseVolumeSizes(result.stdout))
        .catch(() => new Map<string, number>())
      return names.map((name) => {
        const ls = entries.find((item) => asText(item.Name) === name) ?? {}
        const detail = inspected.get(name)
        return {
          name,
          driver: detail?.driver || asText(ls.Driver) || "local",
          mountpoint: detail?.mountpoint ?? "",
          createdAt: detail?.createdAt ?? null,
          sizeBytes:
            parseDockerSize(asText(ls.Size)) ?? sizes.get(name) ?? null,
          inUse: used.has(name),
        }
      })
    })

  const getContainerLogs = async (
    containerId: string,
    options: { tail?: number; since?: number } = {}
  ): Promise<DockerContainerLogsResponse> => {
    assertContainerId(containerId)
    const tail = options.tail ?? 200
    // 多要一行才能区分「正好 tail 行」与「上游还有更多」：
    // 拿到 tail+1 行说明被截断，只保留最后 tail 行。
    const args = ["logs", "--tail", String(tail + 1)]
    if (options.since !== undefined) args.push("--since", String(options.since))
    args.push(containerId)
    // 拒绝非法入参也要走 rejected promise，调用方 await 时行为一致。
    const { stdout, stderr } = await docker(args, TIMEOUT.logs)
    // docker 把容器 stderr 写到自己的 stderr，两边合起来才是完整日志。
    const raw = `${stdout}${stderr}`.split("\n")
    // 只去掉结尾换行产生的那一个空元素，日志中间的空白行要保留。
    if (raw.at(-1) === "") raw.pop()
    const truncated = raw.length > tail
    return {
      containerId,
      lines: truncated ? raw.slice(-tail) : raw,
      truncated,
      fetchedAt: Date.now(),
    }
  }

  const getInfo = (): Promise<DockerInfo> =>
    cache("docker:info", TTL.info, async () =>
      parseInfo(
        (await docker(["info", "--format", "{{json .}}"], TIMEOUT.quick)).stdout
      )
    )

  /** 概览要的磁盘占用：Images 行已去重共享层，比逐镜像求和更准。 */
  const getDiskUsage = (): Promise<Map<string, number>> =>
    cache("docker:disk-usage", TTL.info, async () =>
      parseDiskUsage((await docker(["system", "df"], TIMEOUT.list)).stdout)
    )

  const getVersion = (): Promise<string> =>
    cache("docker:version", TTL.version, async () =>
      parseVersion(
        (await docker(["version", "--format", "{{json .}}"], TIMEOUT.quick))
          .stdout
      )
    )

  // ---- 写命令：只接受标识与受校验的配置，参数一律按固定形式拼装 ----
  const startContainer = async (containerId: string): Promise<void> => {
    assertContainerId(containerId)
    await docker(["start", containerId], TIMEOUT.write)
  }

  const stopContainer = async (
    containerId: string,
    options: { force?: boolean } = {}
  ): Promise<void> => {
    assertContainerId(containerId)
    // 强制停止仍发 SIGTERM（只是不等待），给进程清理机会；
    // 直接 SIGKILL 会损坏正在写盘的容器（如 postgres），那是 killContainer 的事。
    await docker(
      options.force === true
        ? ["stop", "-t", "0", containerId]
        : ["stop", containerId],
      TIMEOUT.write
    )
  }

  /** 立即杀死容器（SIGKILL）：只在前端用更重的确认文案后才调用。 */
  const killContainer = async (containerId: string): Promise<void> => {
    assertContainerId(containerId)
    await docker(["kill", containerId], TIMEOUT.write)
  }

  /**
   * 重新读取单个容器的真实状态（动作后核实用）。
   * 不经过列表缓存，避免拿旧数据当「命令生效」的证据。
   */
  const inspectContainer = async (
    containerId: string
  ): Promise<DockerContainer | null> => {
    assertContainerId(containerId)
    try {
      const { stdout } = await docker(["inspect", containerId], TIMEOUT.quick)
      const [inspected] = parseInspectedContainers(stdout)
      if (!inspected) return null
      return {
        id: inspected.id,
        name: inspected.name,
        image: inspected.image,
        command: inspected.command,
        state: inspected.state,
        // inspect 没有 ps 的「Up 34 minutes」文案，这里用状态本身
        status: inspected.state,
        createdAt: inspected.createdAt ?? 0,
        startedAt: inspected.startedAt,
        ports: inspected.ports,
        mounts: inspected.mounts,
      }
    } catch (error) {
      // 容器已被删除是事实状态，不是故障
      if (isMissingContainerError(error)) return null
      throw error
    }
  }

  const restartContainer = async (
    containerId: string,
    options: { force?: boolean } = {}
  ): Promise<void> => {
    assertContainerId(containerId)
    // 强制重启不等待优雅退出（-t 0）。
    await docker(
      options.force === true
        ? ["restart", "-t", "0", containerId]
        : ["restart", containerId],
      TIMEOUT.write
    )
  }

  const removeContainer = async (
    containerId: string,
    options: { force?: boolean } = {}
  ): Promise<void> => {
    assertContainerId(containerId)
    await docker(
      ["rm", ...(options.force === true ? ["-f"] : []), containerId],
      TIMEOUT.write
    )
  }

  /** 新建并启动容器，返回新容器 id（docker run --detach 的最后一行）。 */
  const createContainer = async (
    config: DockerContainerCreateBody
  ): Promise<string> => {
    const { stdout } = await docker(containerCreateArgs(config), TIMEOUT.write)
    return stdout.trim().split("\n").at(-1) ?? ""
  }

  /**
   * 拉取镜像：边执行边把输出按行回调出去（docker 的进度行用 \n 或 \r 分隔）。
   * 其余命令不需要流式输出，只有 pull 这类长命令用。
   */
  const pullImage = async (
    image: string,
    options: { onLine?: (line: string) => void } = {}
  ): Promise<void> => {
    assertImageReference(image)
    const splitter = options.onLine ? createLineSplitter(options.onLine) : null
    try {
      await docker(
        ["pull", image],
        TIMEOUT.pull,
        splitter ? (chunk) => splitter.push(chunk) : undefined
      )
    } finally {
      splitter?.flush()
    }
  }

  /**
   * 本地是否已有该镜像。用 image inspect 不经列表缓存：
   * 刚拉取的镜像要立刻可见，否则新建容器会被误判成「镜像不存在」。
   */
  const imageExists = async (image: string): Promise<boolean> => {
    assertImageReference(image)
    try {
      await docker(
        ["image", "inspect", "--format", "{{.Id}}", image],
        TIMEOUT.quick
      )
      return true
    } catch (error) {
      if (
        error instanceof DockerCommandError &&
        error.kind === "failed" &&
        /no such image/i.test(error.detail)
      ) {
        return false
      }
      throw error
    }
  }

  const removeImage = async (
    imageId: string,
    options: { force?: boolean } = {}
  ): Promise<void> => {
    assertImageReference(imageId)
    await docker(
      ["image", "rm", ...(options.force === true ? ["-f"] : []), imageId],
      TIMEOUT.write
    )
  }

  const removeVolume = async (name: string): Promise<void> => {
    assertVolumeName(name)
    await docker(["volume", "rm", name], TIMEOUT.write)
  }

  const removeNetwork = async (networkId: string): Promise<void> => {
    assertNetworkId(networkId)
    await docker(["network", "rm", networkId], TIMEOUT.write)
  }

  const getColimaStatus = async (): Promise<DockerColimaStatus> => {
    const checkedAt = Date.now()
    let output = ""
    try {
      const result = await colima(["status"], TIMEOUT.quick)
      output = `${result.stdout}\n${result.stderr}`
    } catch (error) {
      if (
        !(error instanceof DockerCommandError) ||
        error.kind === "not_installed"
      ) {
        throw error
      }
      // colima status 在「未运行时」以非 0 退出，这是状态而不是故障。
      if (
        error.kind !== "failed" ||
        !COLIMA_STOPPED_PATTERN.test(error.detail)
      ) {
        throw error
      }
      return {
        installed: true,
        running: false,
        status: "colima 未运行",
        runtime: null,
        arch: null,
        cpus: null,
        memoryBytes: null,
        diskBytes: null,
        checkedAt,
      }
    }
    const parsed = parseColimaStatus(output)
    if (!parsed.running) {
      return {
        installed: true,
        running: false,
        status: "colima 未运行",
        runtime: null,
        arch: null,
        cpus: null,
        memoryBytes: null,
        diskBytes: null,
        checkedAt,
      }
    }
    return {
      installed: true,
      running: true,
      status: "colima 运行中",
      runtime: parsed.runtime,
      arch: parsed.arch,
      // status 文本不提供资源配额，需要这些数字时改用 colima list。
      cpus: null,
      memoryBytes: null,
      diskBytes: null,
      checkedAt,
    }
  }

  const startColima = async (): Promise<string> => {
    const result = await colima(["start"], TIMEOUT.colimaStart)
    return (
      firstMeaningfulLine(`${result.stdout}\n${result.stderr}`) ??
      "colima 已启动"
    )
  }

  const stopColima = async (): Promise<string> => {
    const result = await colima(["stop"], TIMEOUT.colimaStop)
    return (
      firstMeaningfulLine(`${result.stdout}\n${result.stderr}`) ??
      "colima 已停止"
    )
  }

  return {
    listContainers,
    listImages,
    listVolumes,
    listNetworks,
    getContainerLogs,
    getInfo,
    getDiskUsage,
    getVersion,
    getColimaStatus,
    startColima,
    stopColima,
    startContainer,
    stopContainer,
    restartContainer,
    killContainer,
    removeContainer,
    createContainer,
    pullImage,
    imageExists,
    removeImage,
    removeVolume,
    removeNetwork,
    inspectContainer,
  }
}

/** 生产使用的默认执行层实例。 */
export const dockerCli = createDockerCli()
