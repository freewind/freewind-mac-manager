import { invalidateCached } from "@server/common/collect"
import {
  type PublicErrorStatus,
  PublicOperationError,
  publicSystemError,
} from "@server/common/public-error"
import { toTaskHttpResponse } from "@server/common/tasks/response"
import {
  COLIMA_ACTION_KIND,
  type ColimaActionPayload,
} from "@server/docker/colima-task"
import {
  DOCKER_ACTION_KIND,
  type DockerActionPayload,
  dockerActionTargetOf,
} from "@server/docker/task"
import type { TaskRuntime } from "@server/tasks/runtime"
import {
  type ActionResponse,
  contract,
  type DockerContainerActionBody,
  type DockerContainerCreated,
  TASK_REQUEST_ID_HEADER,
} from "@shared/api-contract"
import { ActionResponseSchema } from "@shared/api-contract/schemas/common"
import { DockerContainerCreatedSchema } from "@shared/api-contract/schemas/docker"
import { dockerColimaTaskTarget } from "@shared/task-targets"
import { initServer } from "@ts-rest/express"
import {
  DockerCommandError,
  isMissingContainerError,
  markDockerWritePending,
} from "./cli"
import type { DockerService } from "./service"

const s = initServer()

/** 只挑本功能的路由：只读 7 条 + 容器动作两条。 */
export const dockerContract = {
  getDockerOverview: contract.getDockerOverview,
  listDockerContainers: contract.listDockerContainers,
  getDockerContainerLogs: contract.getDockerContainerLogs,
  listDockerImages: contract.listDockerImages,
  listDockerVolumes: contract.listDockerVolumes,
  listDockerNetworks: contract.listDockerNetworks,
  getDockerColimaStatus: contract.getDockerColimaStatus,
  actOnDockerContainer: contract.actOnDockerContainer,
  removeDockerContainer: contract.removeDockerContainer,
  createDockerContainer: contract.createDockerContainer,
  pullDockerImage: contract.pullDockerImage,
  removeDockerImage: contract.removeDockerImage,
  removeDockerVolume: contract.removeDockerVolume,
  removeDockerNetwork: contract.removeDockerNetwork,
  actOnDockerColima: contract.actOnDockerColima,
}

/** 只读端点没有「创建」与「状态冲突」语义，409 一律收敛成 500。 */
const toReadStatus = (status: PublicErrorStatus): 400 | 403 | 404 | 500 =>
  status === 409 ? 500 : status

const statusOf = (error: DockerCommandError): PublicErrorStatus => {
  if (error.kind === "invalid_input") return 400
  // 资源被占用是状态冲突，不是服务器故障
  if (error.kind === "conflict") return 409
  if (isMissingContainerError(error)) return 404
  return 500
}

/**
 * 对外文案一律固定中文，命令输出、路径与堆栈留在服务端日志，
 * 不通过响应体泄露内部细节。
 */
const messageOf = (error: DockerCommandError): string => {
  switch (error.kind) {
    case "invalid_input":
      return "容器标识不合法，请重新读取列表"
    case "not_installed":
      return "未安装 Docker 或 Colima，请先安装"
    case "daemon_unavailable":
      return "Docker 未运行，请先启动 Colima"
    case "conflict":
      return "该镜像被容器使用中，请先删除相关容器，或显式选择强制删除"
    case "timeout":
      return "Docker 命令执行超时，请稍后重试"
    default:
      return isMissingContainerError(error)
        ? "容器不存在，请重新读取列表"
        : "Docker 操作未能完成，请重新读取目标核实"
  }
}

/** 域内错误与未知异常都走 common 的公开化模式，只保留可读中文消息。 */
const mapError = (
  error: unknown
): { status: PublicErrorStatus; body: { message: string } } =>
  error instanceof DockerCommandError
    ? publicSystemError(
        new PublicOperationError(statusOf(error), messageOf(error))
      )
    : publicSystemError(error)

/** 只读端点：409 没有语义，收敛成 500。 */
const fail = (
  error: unknown
): { status: 400 | 403 | 404 | 500; body: { message: string } } => {
  const mapped = mapError(error)
  return { status: toReadStatus(mapped.status), body: mapped.body }
}

/** 写端点：保留 409，与运行时给出的冲突共用同一状态码。 */
const failWrite = (
  error: unknown
): { status: 400 | 403 | 404 | 409 | 500; body: { message: string } } => {
  const mapped = mapError(error)
  return { status: mapped.status, body: mapped.body }
}

/** 契约动作名 → 执行器动作名；kill 是独立的 SIGKILL 动作，不与 stop 混用。 */
const containerActionPayload = (
  body: DockerContainerActionBody
): DockerActionPayload => {
  switch (body.action) {
    case "start":
      return { action: "containerStart", containerId: body.containerId }
    case "stop":
      return {
        action: "containerStop",
        containerId: body.containerId,
        force: body.force,
      }
    case "restart":
      return {
        action: "containerRestart",
        containerId: body.containerId,
        force: body.force,
      }
    case "kill":
      return { action: "containerKill", containerId: body.containerId }
  }
}

/**
 * 容器动作经统一运行器提交：请求标识由契约 headers 强制校验，
 * 同容器同一时刻只做一个动作；载荷只含标识与枚举，不接受命令或参数。
 */
/**
 * 写操作会改真实状态，而只读列表带 TTL 缓存。
 * 执行器跑在任务子进程里，它的缓存失效影响不到本进程，所以父进程在提交写请求前
 * 主动清掉 Docker 域的只读缓存：紧接着的读会重新执行 docker 命令，
 * 而不是命中写之前的旧值。（子进程侧 cli 也会失效，两边都做。）
 */
const invalidateDockerReads = (): void => {
  invalidateCached("docker:")
  // 动作可能超过响应阈值才在子进程里完成，父进程在宽限期内不读缓存
  markDockerWritePending()
}

/** 动作类完成结果都是 ActionResponse；新建容器额外带资源标识。 */
const actionResponseOf = (result: unknown): ActionResponse => {
  const parsed = ActionResponseSchema.safeParse(result)
  if (!parsed.success) {
    throw new Error("动作结果不符合契约，无法作为完成结果返回")
  }
  return parsed.data
}

/** 所有 Docker 写端点共用：提交任务并按完成状态返回。 */
const submitDockerAction = async <TBody>(
  runtime: TaskRuntime,
  options: {
    payload: DockerActionPayload
    requestId: string
    completedStatus: 200 | 201
    parseCompleted: (result: unknown) => TBody
  }
) => {
  const outcome = await runtime.runner.submit<TBody>({
    kind: DOCKER_ACTION_KIND,
    // 冲突锁按操作对象推导：映射只有 dockerActionTargetOf 一处实现
    target: dockerActionTargetOf(options.payload),
    payload: options.payload,
    requestId: options.requestId,
    toCompletedResponse: (result) => ({
      status: options.completedStatus,
      body: options.parseCompleted(result.result),
    }),
  })
  return toTaskHttpResponse(outcome, options.completedStatus)
}

const submitContainerAction = (
  runtime: TaskRuntime,
  options: { payload: DockerActionPayload; requestId: string }
) =>
  submitDockerAction(runtime, {
    ...options,
    completedStatus: 200,
    parseCompleted: actionResponseOf,
  })

/** Colima 动作是另一种任务种类，作用域是整台虚拟机。 */
const submitColimaAction = async (
  runtime: TaskRuntime,
  options: { payload: ColimaActionPayload; requestId: string }
) => {
  const outcome = await runtime.runner.submit<ActionResponse>({
    kind: COLIMA_ACTION_KIND,
    target: dockerColimaTaskTarget(),
    payload: options.payload,
    requestId: options.requestId,
    toCompletedResponse: (result) => ({
      status: 200,
      body: actionResponseOf(result.result),
    }),
  })
  return toTaskHttpResponse(outcome, 200)
}

export const createDockerRouter = (
  service: DockerService,
  runtime: TaskRuntime
) =>
  s.router(dockerContract, {
    getDockerOverview: async () => {
      try {
        return { status: 200 as const, body: await service.getOverview() }
      } catch (error) {
        return fail(error)
      }
    },

    listDockerContainers: async () => {
      try {
        return { status: 200 as const, body: await service.listContainers() }
      } catch (error) {
        return fail(error)
      }
    },

    getDockerContainerLogs: async ({ query }) => {
      try {
        return {
          status: 200 as const,
          body: await service.getContainerLogs(query),
        }
      } catch (error) {
        return fail(error)
      }
    },

    listDockerImages: async () => {
      try {
        return { status: 200 as const, body: await service.listImages() }
      } catch (error) {
        return fail(error)
      }
    },

    listDockerVolumes: async () => {
      try {
        return { status: 200 as const, body: await service.listVolumes() }
      } catch (error) {
        return fail(error)
      }
    },

    listDockerNetworks: async () => {
      try {
        return { status: 200 as const, body: await service.listNetworks() }
      } catch (error) {
        return fail(error)
      }
    },

    getDockerColimaStatus: async () => {
      try {
        return { status: 200 as const, body: await service.getColimaStatus() }
      } catch (error) {
        return fail(error)
      }
    },

    // 容器不存在在提交前就查实，避免把 404 的任务交给运行时当失败处理。
    actOnDockerContainer: async ({ headers, body }) => {
      try {
        invalidateDockerReads()
        if ((await service.findContainer(body.containerId)) === null) {
          return {
            status: 404 as const,
            body: { message: "容器不存在，请重新读取列表" },
          }
        }
        return await submitContainerAction(runtime, {
          payload: containerActionPayload(body),
          requestId: headers[TASK_REQUEST_ID_HEADER],
        })
      } catch (error) {
        return failWrite(error)
      }
    },

    createDockerContainer: async ({ headers, body }) => {
      try {
        invalidateDockerReads()
        // 本地没有这个镜像就直接拒绝：docker run 会偷偷联网拉取，用户没同意过
        if (!(await service.imageExists(body.image))) {
          return {
            status: 409 as const,
            body: {
              message: "本地没有该镜像，请先在镜像页拉取",
              executionStatus: "not_started" as const,
            },
          }
        }
        if (
          body.name !== undefined &&
          (await service.findContainer(body.name)) !== null
        ) {
          return {
            status: 409 as const,
            body: {
              message: `容器名 ${body.name} 已被占用，请换一个名字`,
              executionStatus: "not_started" as const,
            },
          }
        }
        return await submitDockerAction<DockerContainerCreated>(runtime, {
          payload: { action: "containerCreate", container: body },
          // 新容器还没有 id，按名字（未指定时按镜像）加锁
          requestId: headers[TASK_REQUEST_ID_HEADER],
          completedStatus: 201,
          parseCompleted: (result) => {
            const parsed = DockerContainerCreatedSchema.safeParse(result)
            if (!parsed.success) {
              throw new Error("新建容器结果不符合契约，无法作为完成结果返回")
            }
            return parsed.data
          },
        })
      } catch (error) {
        return failWrite(error)
      }
    },

    pullDockerImage: async ({ headers, body }) => {
      try {
        invalidateDockerReads()
        return await submitDockerAction(runtime, {
          payload: { action: "imagePull", image: body.image },
          requestId: headers[TASK_REQUEST_ID_HEADER],
          completedStatus: 200,
          parseCompleted: actionResponseOf,
        })
      } catch (error) {
        return failWrite(error)
      }
    },

    removeDockerImage: async ({ headers, body }) => {
      try {
        invalidateDockerReads()
        // 默认不带 -f：被容器引用时由 docker 拒绝，再映射成 409
        return await submitDockerAction(runtime, {
          payload: {
            action: "imageRemove",
            imageId: body.imageId,
            force: body.force,
          },
          requestId: headers[TASK_REQUEST_ID_HEADER],
          completedStatus: 200,
          parseCompleted: actionResponseOf,
        })
      } catch (error) {
        return failWrite(error)
      }
    },

    removeDockerVolume: async ({ headers, body }) => {
      try {
        invalidateDockerReads()
        // 被容器使用的卷由 docker 拒绝，再映射成 409
        return await submitDockerAction(runtime, {
          payload: { action: "volumeRemove", name: body.name },
          requestId: headers[TASK_REQUEST_ID_HEADER],
          completedStatus: 200,
          parseCompleted: actionResponseOf,
        })
      } catch (error) {
        return failWrite(error)
      }
    },

    removeDockerNetwork: async ({ headers, body }) => {
      try {
        invalidateDockerReads()
        // 内置网络与仍有容器接入的网络都会在执行器里被拒绝（409）
        return await submitDockerAction(runtime, {
          payload: { action: "networkRemove", networkId: body.networkId },
          requestId: headers[TASK_REQUEST_ID_HEADER],
          completedStatus: 200,
          parseCompleted: actionResponseOf,
        })
      } catch (error) {
        return failWrite(error)
      }
    },

    actOnDockerColima: async ({ headers, body }) => {
      try {
        invalidateDockerReads()
        // 状态冲突在执行前就判掉：运行中再 start、未运行就 stop 都是白跑
        const status = await service.getColimaStatus()
        if (body.action === "start" && status.running) {
          return {
            status: 409 as const,
            body: {
              message: "Colima 已在运行",
              executionStatus: "not_started" as const,
            },
          }
        }
        if (body.action !== "start" && !status.running) {
          return {
            status: 409 as const,
            body: {
              message: "Colima 未在运行",
              executionStatus: "not_started" as const,
            },
          }
        }
        return await submitColimaAction(runtime, {
          payload: { action: body.action },
          requestId: headers[TASK_REQUEST_ID_HEADER],
        })
      } catch (error) {
        return failWrite(error)
      }
    },

    removeDockerContainer: async ({ headers, body }) => {
      try {
        invalidateDockerReads()
        const container = await service.findContainer(body.containerId)
        if (container === null) {
          return {
            status: 404 as const,
            body: { message: "容器不存在，请重新读取列表" },
          }
        }
        // 绝不悄悄加 -f：正在运行的容器必须先停，或由用户显式选择强制删除。
        if (container.state === "running" && body.force !== true) {
          return {
            status: 409 as const,
            body: {
              message: "容器正在运行，请先停止容器，或显式选择强制删除",
              executionStatus: "not_started" as const,
            },
          }
        }
        return await submitContainerAction(runtime, {
          payload: {
            action: "containerRemove",
            containerId: body.containerId,
            force: body.force,
          },
          requestId: headers[TASK_REQUEST_ID_HEADER],
        })
      } catch (error) {
        return failWrite(error)
      }
    },
  })
