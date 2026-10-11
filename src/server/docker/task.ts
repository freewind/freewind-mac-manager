import type { ActionResponse, TaskProgress } from "@shared/api-contract"
import { TASK_KINDS } from "@shared/api-contract"
import { DockerContainerCreateBodySchema } from "@shared/api-contract/schemas/docker"
import {
  dockerContainerTaskTarget,
  dockerImageTaskTarget,
  dockerNetworkTaskTarget,
  dockerVolumeTaskTarget,
} from "@shared/task-targets"
import { z } from "zod"
import { type DockerCli, dockerCli } from "./cli"

/** 容器/镜像/卷/网络的写操作共用一种任务种类（与 service_action 做法一致）。 */
export const DOCKER_ACTION_KIND = TASK_KINDS.dockerAction

/** 作用域标识沿用契约里的字符白名单，避免拼出 docker 自己的选项。 */
const identifier = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "标识包含非法字符")

/** 镜像引用允许仓库/标签/摘要里的 / : @ . -。 */
const imageReference = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/, "镜像引用包含非法字符")

/**
 * 执行器载荷：只允许标识、枚举与受校验的配置。
 * 用 strict 拒绝多余字段，因此外部塞进命令字符串或 shell 片段会让整个载荷非法，
 * 而不是被悄悄忽略。
 */
export const DockerActionPayloadSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("containerStart"),
      containerId: identifier(128),
    })
    .strict(),
  z
    .object({
      action: z.literal("containerStop"),
      containerId: identifier(128),
      force: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("containerRestart"),
      containerId: identifier(128),
      force: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("containerRemove"),
      containerId: identifier(128),
      force: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("containerCreate"),
      container: DockerContainerCreateBodySchema,
    })
    .strict(),
  z.object({ action: z.literal("imagePull"), image: imageReference }).strict(),
  z
    .object({
      action: z.literal("imageRemove"),
      imageId: imageReference,
      force: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("volumeRemove"),
      name: identifier(255),
    })
    .strict(),
  z
    .object({
      action: z.literal("networkRemove"),
      networkId: identifier(128),
    })
    .strict(),
])

export type DockerActionPayload = z.infer<typeof DockerActionPayloadSchema>

/** 按操作对象加锁：同对象互斥，不同对象可并行。 */
export const dockerActionTargetOf = (payload: DockerActionPayload): string => {
  switch (payload.action) {
    case "containerStart":
    case "containerStop":
    case "containerRestart":
    case "containerRemove":
      return dockerContainerTaskTarget(payload.containerId)
    case "containerCreate":
      // 新容器还没有 id，用名字（未指定时退回镜像名）作为作用域
      return dockerContainerTaskTarget(
        payload.container.name ?? payload.container.image
      )
    case "imagePull":
      return dockerImageTaskTarget(payload.image)
    case "imageRemove":
      return dockerImageTaskTarget(payload.imageId)
    case "volumeRemove":
      return dockerVolumeTaskTarget(payload.name)
    case "networkRemove":
      return dockerNetworkTaskTarget(payload.networkId)
  }
}

/** 执行器只需要这些写能力，测试可以只实现它们。 */
export type DockerActionCli = Pick<
  DockerCli,
  | "startContainer"
  | "stopContainer"
  | "restartContainer"
  | "removeContainer"
  | "createContainer"
  | "pullImage"
  | "removeImage"
  | "removeVolume"
  | "removeNetwork"
>

/** 进度文案：动作名与对象都写成中文可读形式。 */
const stageOf = (payload: DockerActionPayload): string => {
  switch (payload.action) {
    case "containerStart":
      return `启动容器 ${payload.containerId}`
    case "containerStop":
      return `停止容器 ${payload.containerId}`
    case "containerRestart":
      return `重启容器 ${payload.containerId}`
    case "containerRemove":
      return `删除容器 ${payload.containerId}`
    case "containerCreate":
      return `创建容器 ${payload.container.name ?? payload.container.image}`
    case "imagePull":
      return `拉取镜像 ${payload.image}`
    case "imageRemove":
      return `删除镜像 ${payload.imageId}`
    case "volumeRemove":
      return `删除卷 ${payload.name}`
    case "networkRemove":
      return `删除网络 ${payload.networkId}`
  }
}

/**
 * 按动作分派到 cli。
 * 命令执行完只说明命令跑完了：容器启停与创建是否真的生效，由列表重新读取确认，
 * 因此文案不承诺「已运行」。
 */
const dispatch = async (
  cli: DockerActionCli,
  payload: DockerActionPayload
): Promise<string> => {
  switch (payload.action) {
    case "containerStart":
      await cli.startContainer(payload.containerId)
      return `容器 ${payload.containerId} 的启动命令已执行，请重新读取列表确认`
    case "containerStop":
      await cli.stopContainer(payload.containerId, { force: payload.force })
      return `容器 ${payload.containerId} 的停止命令已执行，请重新读取列表确认`
    case "containerRestart":
      await cli.restartContainer(payload.containerId, {
        force: payload.force,
      })
      return `容器 ${payload.containerId} 的重启命令已执行，请重新读取列表确认`
    case "containerRemove":
      await cli.removeContainer(payload.containerId, { force: payload.force })
      return `容器 ${payload.containerId} 已删除`
    case "containerCreate": {
      const containerId = await cli.createContainer(payload.container)
      return `容器 ${containerId || (payload.container.name ?? payload.container.image)} 已创建`
    }
    case "imagePull":
      await cli.pullImage(payload.image)
      return `镜像 ${payload.image} 拉取完成`
    case "imageRemove":
      await cli.removeImage(payload.imageId, { force: payload.force })
      return `镜像 ${payload.imageId} 已删除`
    case "volumeRemove":
      await cli.removeVolume(payload.name)
      return `卷 ${payload.name} 已删除`
    case "networkRemove":
      await cli.removeNetwork(payload.networkId)
      return `网络 ${payload.networkId} 已删除`
  }
}

export const runDockerActionTask = async (options: {
  payload: unknown
  report: (progress: TaskProgress) => void
  /** 默认生产实例；测试注入受控替身。 */
  cli?: DockerActionCli
}): Promise<{ result: ActionResponse; message: string }> => {
  const parsed = DockerActionPayloadSchema.safeParse(options.payload)
  // 校验失败绝不发命令：这里直接抛，调用方按失败任务处理。
  if (!parsed.success) throw new Error("Docker 动作载荷非法")
  const payload = parsed.data
  const cli = options.cli ?? dockerCli
  options.report({
    done: 0,
    total: 1,
    bytesDone: null,
    bytesTotal: null,
    stage: stageOf(payload),
    currentTarget: dockerActionTargetOf(payload),
  })
  const message = await dispatch(cli, payload)
  options.report({
    done: 1,
    total: 1,
    bytesDone: null,
    bytesTotal: null,
    stage: "完成",
    currentTarget: null,
  })
  return { result: { message }, message }
}
