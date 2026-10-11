import { PublicOperationError } from "@server/common/public-error"
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
import {
  createPullProgressTracker,
  type DockerCli,
  DockerCommandError,
  dockerCli,
} from "./cli"

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
      action: z.literal("containerKill"),
      containerId: identifier(128),
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
    case "containerKill":
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

/** 执行器只需要这些读写能力，测试可以只实现它们。 */
export type DockerActionCli = Pick<
  DockerCli,
  | "startContainer"
  | "stopContainer"
  | "restartContainer"
  | "killContainer"
  | "removeContainer"
  | "createContainer"
  | "pullImage"
  | "removeImage"
  | "removeVolume"
  | "removeNetwork"
  | "inspectContainer"
  | "imageExists"
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
    case "containerKill":
      return `强制终止容器 ${payload.containerId}`
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
 * 动作后重新读取真实状态：命令退出码为 0 不等于状态真的变了，
 * 因此 message 一律以核实结果为准；核不到就如实报失败，不谎报成功。
 */
const verifyContainer = async (
  cli: DockerActionCli,
  options: {
    containerId: string
    /** 期望状态；removed 表示期望已经不存在 */
    expectation: "running" | "stopped" | "removed"
    /** 成功时的文案；未提供时按期望状态生成 */
    successMessage?: (label: string) => string
    /** 删除前拿到的名字，删除后就查不到了 */
    fallbackLabel?: string
  }
): Promise<string> => {
  const container = await cli.inspectContainer(options.containerId)
  if (options.expectation === "removed") {
    if (container === null) {
      const label = options.fallbackLabel || options.containerId
      return `已删除 ${label}`
    }
    throw new PublicOperationError(
      500,
      `容器 ${container.name || options.containerId} 仍然存在，删除未生效`
    )
  }
  if (container === null) {
    throw new PublicOperationError(
      500,
      `容器 ${options.containerId} 已不存在，无法确认结果`
    )
  }
  const label = container.name || options.containerId
  const running = container.state === "running"
  if (options.expectation === "running" && !running) {
    throw new PublicOperationError(
      500,
      `容器 ${label} 的状态是 ${container.state}，未启动成功`
    )
  }
  if (options.expectation === "stopped" && running) {
    throw new PublicOperationError(
      500,
      `容器 ${label} 仍在运行，停止命令未生效`
    )
  }
  return options.successMessage
    ? options.successMessage(label)
    : options.expectation === "running"
      ? `已启动 ${label}`
      : `已停止 ${label}`
}

/**
 * 按动作分派到 cli，并在执行后重新读取目标状态。
 * 容器动作以核实到的状态为准；镜像/卷/网络的列表带缓存，本轮只如实说明
 * 「已发出命令」，不把命令跑完当成状态已变。
 */
/** 新建容器核实后的结论：含新资源标识与如实说明。 */
type CreatedContainer = { containerId: string; name: string }

/**
 * 新容器核实：docker run 退出码为 0 只说明命令跑完了，
 * 镜像的容器可能立刻退出，因此状态以重新 inspect 的结果为准。
 */
const verifyCreated = async (
  cli: DockerActionCli,
  containerId: string,
  fallbackName: string | undefined
): Promise<{ message: string; created: CreatedContainer }> => {
  const container = await cli.inspectContainer(containerId)
  if (container === null) {
    throw new PublicOperationError(
      500,
      `容器 ${fallbackName ?? containerId} 已创建但查不到，请重新读取列表确认`
    )
  }
  const name = container.name || fallbackName || containerId
  const created = { containerId, name }
  if (container.state === "running") {
    return { message: `已创建并启动 ${name}`, created }
  }
  return {
    message: `容器 ${name} 已创建，但状态是 ${container.state}，请查看日志确认原因`,
    created,
  }
}

const dispatch = async (
  cli: DockerActionCli,
  payload: DockerActionPayload,
  /** 中间进度上报：目前只有拉取镜像需要 */
  reportProgress: (progress: {
    done: number
    total: number | null
    bytesDone: number | null
    bytesTotal: number | null
    stage: string
    currentTarget: string | null
  }) => void
): Promise<{ message: string; created?: CreatedContainer }> => {
  switch (payload.action) {
    case "containerStart":
      await cli.startContainer(payload.containerId)
      return {
        message: await verifyContainer(cli, {
          containerId: payload.containerId,
          expectation: "running",
          successMessage: (label) => `已启动 ${label}`,
        }),
      }
    case "containerStop":
      await cli.stopContainer(payload.containerId, { force: payload.force })
      return {
        message: await verifyContainer(cli, {
          containerId: payload.containerId,
          expectation: "stopped",
          successMessage: (label) => `已停止 ${label}`,
        }),
      }
    case "containerKill":
      await cli.killContainer(payload.containerId)
      return {
        message: await verifyContainer(cli, {
          containerId: payload.containerId,
          expectation: "stopped",
          successMessage: (label) => `已终止 ${label}`,
        }),
      }
    case "containerRestart":
      await cli.restartContainer(payload.containerId, {
        force: payload.force,
      })
      return {
        message: await verifyContainer(cli, {
          containerId: payload.containerId,
          expectation: "running",
          successMessage: (label) => `已重启 ${label}`,
        }),
      }
    case "containerRemove": {
      // 删除后就查不到名字了，先记住它
      const before = await cli.inspectContainer(payload.containerId)
      await cli.removeContainer(payload.containerId, { force: payload.force })
      return {
        message: await verifyContainer(cli, {
          containerId: payload.containerId,
          expectation: "removed",
          fallbackLabel: before?.name ?? payload.containerId,
        }),
      }
    }
    case "containerCreate": {
      const containerId = await cli.createContainer(payload.container)
      return await verifyCreated(cli, containerId, payload.container.name)
    }
    case "imagePull": {
      const image = payload.image
      const tracker = createPullProgressTracker()
      const reportPull = (): void => {
        const progress = tracker.snapshot()
        reportProgress({
          done: progress.completed,
          total: progress.layers,
          bytesDone: progress.bytesDone,
          bytesTotal: progress.bytesTotal,
          stage: `正在拉取 ${image} (${progress.completed}/${progress.layers} 层)`,
          currentTarget: image,
        })
      }
      await cli.pullImage(image, {
        onLine: (line) => {
          // 只有真带来变化（新层、完成、字节变化）的行才上报
          if (tracker.push(line)) reportPull()
        },
      })
      reportPull()
      // 命令结束不等于镜像落地：必须重新核实
      if (!(await cli.imageExists(image))) {
        throw new PublicOperationError(
          500,
          `镜像 ${image} 拉取已结束，但本地查不到该镜像，请重新读取镜像列表确认`
        )
      }
      return { message: `镜像 ${image} 拉取完成` }
    }
    case "imageRemove": {
      try {
        // 默认不带 -f：被容器引用时让 docker 拒绝，由下面翻译成 409
        await cli.removeImage(payload.imageId, { force: payload.force })
      } catch (error) {
        if (error instanceof DockerCommandError && error.kind === "conflict") {
          throw new PublicOperationError(
            409,
            "该镜像被容器使用中，请先删除相关容器，或显式选择强制删除"
          )
        }
        throw error
      }
      if (await cli.imageExists(payload.imageId)) {
        throw new PublicOperationError(
          500,
          `镜像 ${payload.imageId} 仍然存在，删除未生效`
        )
      }
      return { message: `已删除镜像 ${payload.imageId}` }
    }
    case "volumeRemove":
      await cli.removeVolume(payload.name)
      return {
        message: `已发出删除卷 ${payload.name} 的命令，请重新读取列表确认`,
      }
    case "networkRemove":
      await cli.removeNetwork(payload.networkId)
      return {
        message: `已发出删除网络 ${payload.networkId} 的命令，请重新读取列表确认`,
      }
  }
}

export const runDockerActionTask = async (options: {
  payload: unknown
  report: (progress: TaskProgress) => void
  /** 默认生产实例；测试注入受控替身。 */
  cli?: DockerActionCli
}): Promise<{
  /** 动作结果是 message；新建容器额外带新资源标识，供 201 端点返回。 */
  result: ActionResponse & { containerId?: string; name?: string }
  message: string
}> => {
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
  const outcome = await dispatch(cli, payload, options.report)
  options.report({
    done: 1,
    total: 1,
    bytesDone: null,
    bytesTotal: null,
    stage: "完成",
    currentTarget: null,
  })
  const result = outcome.created
    ? { message: outcome.message, ...outcome.created }
    : { message: outcome.message }
  return { result, message: outcome.message }
}
