import { z } from "zod"

/** 能对单个容器执行的动作；页面按钮与后端校验共用这份清单。 */
export const DOCKER_CONTAINER_ACTIONS = [
  "start",
  "stop",
  "restart",
  "kill",
] as const

export const DockerContainerActionSchema = z.enum(DOCKER_CONTAINER_ACTIONS)

/** 能对 Colima 虚拟机执行的动作；与容器动作语义不同，单独定义。 */
export const DOCKER_COLIMA_ACTIONS = ["start", "stop", "restart"] as const

export const DockerColimaActionSchema = z.enum(DOCKER_COLIMA_ACTIONS)

/** 容器运行态，取值对齐 `docker ps` 的 State 字段。 */
export const DOCKER_CONTAINER_STATES = [
  "created",
  "running",
  "paused",
  "restarting",
  "removing",
  "exited",
  "dead",
] as const

export const DockerContainerStateSchema = z.enum(DOCKER_CONTAINER_STATES)

/** 容器标识：短 id 或完整 id 都接受。 */
const ContainerIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/, "容器标识包含非法字符")

/** 一条端口映射；未发布宿主端口时 hostPort 为 null。 */
export const DockerPortMappingSchema = z.object({
  hostIp: z.string(),
  hostPort: z.number().int().nullable(),
  containerPort: z.number().int(),
  protocol: z.enum(["tcp", "udp"]),
})

/** 一条挂载；只读挂载用 readOnly 表示。 */
export const DockerMountSchema = z.object({
  type: z.enum(["bind", "volume", "tmpfs"]),
  source: z.string(),
  destination: z.string(),
  readOnly: z.boolean(),
})

export const DockerContainerSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  command: z.string(),
  state: DockerContainerStateSchema,
  /** `docker ps` 的状态描述，例如 "Up 3 hours"。 */
  status: z.string(),
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  ports: z.array(DockerPortMappingSchema),
  mounts: z.array(DockerMountSchema),
})

export const DockerContainersResponseSchema = z.object({
  containers: z.array(DockerContainerSchema),
  /** 读取时被跳过的容器及原因。 */
  skipped: z.array(z.object({ id: z.string(), reason: z.string() })),
})

/** 新建容器的完成结果：返回新资源标识与核实结论。 */
export const DockerContainerCreatedSchema = z.object({
  containerId: z.string(),
  name: z.string(),
  /** 核实结论：容器可能创建后立刻退出，这里如实说明实际状态。 */
  message: z.string(),
})

/** Colima 虚拟机状态；docker daemon 由它提供。 */
export const DockerColimaStatusSchema = z.object({
  /** 本机是否装了 colima 命令 */
  installed: z.boolean(),
  running: z.boolean(),
  /** colima status 的原文摘要，未安装或未运行时给出原因 */
  status: z.string(),
  runtime: z.string().nullable(),
  arch: z.string().nullable(),
  cpus: z.number().int().nullable(),
  memoryBytes: z.number().int().nullable(),
  diskBytes: z.number().int().nullable(),
  checkedAt: z.number(),
})

export const DockerOverviewSchema = z.object({
  /** docker CLI 是否可用；不可用时版本为 null、计数为 0。 */
  available: z.boolean(),
  version: z.string().nullable(),
  colima: DockerColimaStatusSchema,
  containers: z.object({
    total: z.number().int(),
    running: z.number().int(),
    paused: z.number().int(),
    stopped: z.number().int(),
  }),
  images: z.object({ total: z.number().int(), sizeBytes: z.number().int() }),
  volumes: z.object({ total: z.number().int() }),
  networks: z.object({ total: z.number().int() }),
  checkedAt: z.number(),
})

export const DockerImageSchema = z.object({
  id: z.string(),
  repository: z.string(),
  tag: z.string(),
  sizeBytes: z.number().int(),
  createdAt: z.number(),
  /** 引用该镜像的容器数；大于 0 时普通删除会被拒绝。 */
  containers: z.number().int(),
})

export const DockerImagesResponseSchema = z.object({
  images: z.array(DockerImageSchema),
})

export const DockerVolumeSchema = z.object({
  name: z.string(),
  driver: z.string(),
  mountpoint: z.string(),
  createdAt: z.number().nullable(),
  sizeBytes: z.number().int().nullable(),
  /** 被容器引用时为 true，删除会被拒绝。 */
  inUse: z.boolean(),
})

export const DockerVolumesResponseSchema = z.object({
  volumes: z.array(DockerVolumeSchema),
})

export const DockerNetworkSchema = z.object({
  id: z.string(),
  name: z.string(),
  driver: z.string(),
  scope: z.string(),
  internal: z.boolean(),
  /** 接入该网络的容器数。 */
  containers: z.number().int(),
})

export const DockerNetworksResponseSchema = z.object({
  networks: z.array(DockerNetworkSchema),
})

/** 日志查询：只读，参数走 query。 */
export const DockerContainerLogsQuerySchema = z.object({
  containerId: ContainerIdSchema,
  tail: z.coerce.number().int().min(1).max(2000).optional(),
  /** 只取该时间点之后的日志，毫秒时间戳。 */
  since: z.coerce.number().int().nonnegative().optional(),
})

export const DockerContainerLogsResponseSchema = z.object({
  containerId: z.string(),
  lines: z.array(z.string()),
  /** 日志超过 tail 上限、只返回末段时为 true。 */
  truncated: z.boolean(),
  fetchedAt: z.number(),
})

/** 新建容器：只接受可校验的配置，路径与运行态由服务端解析。 */
export const DockerContainerCreateBodySchema = z.object({
  // 首字符必须是字母数字：挡住 --rm 这类被当成 docker 选项的取值
  image: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/, "镜像引用包含非法字符"),
  name: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, "容器名包含非法字符")
    .optional(),
  /** 覆盖镜像的启动命令。 */
  command: z.array(z.string().min(1).max(1024)).max(64).optional(),
  ports: z
    .array(
      z.object({
        hostPort: z.number().int().min(1).max(65535),
        containerPort: z.number().int().min(1).max(65535),
        protocol: z.enum(["tcp", "udp"]),
      })
    )
    .max(32)
    .optional(),
  env: z
    .array(z.object({ name: z.string().min(1).max(255), value: z.string() }))
    .max(64)
    .optional(),
  volumes: z
    .array(
      z.object({
        source: z.string().min(1).max(1024),
        destination: z.string().min(1).max(1024),
      })
    )
    .max(32)
    .optional(),
  restartPolicy: z
    .enum(["no", "always", "unless-stopped", "on-failure"])
    .optional(),
})

/** 容器动作入参；force 只对 stop 与 restart 生效。 */
export const DockerContainerActionBodySchema = z.object({
  containerId: ContainerIdSchema,
  action: DockerContainerActionSchema,
  force: z.boolean().optional(),
})

/** 删除容器：运行中容器需要 force 才允许删除。 */
export const DockerContainerDeleteBodySchema = z.object({
  containerId: ContainerIdSchema,
  force: z.boolean().optional(),
})

export const DockerImagePullBodySchema = z.object({
  image: z.string().min(1).max(255),
})

/** 删除镜像：被容器引用时需要 force 才允许删除。 */
export const DockerImageDeleteBodySchema = z.object({
  imageId: z.string().min(1).max(255),
  force: z.boolean().optional(),
})

export const DockerVolumeDeleteBodySchema = z.object({
  name: z.string().min(1).max(255),
})

export const DockerNetworkDeleteBodySchema = z.object({
  networkId: z.string().min(1).max(128),
})

export const DockerColimaActionBodySchema = z.object({
  action: DockerColimaActionSchema,
})
