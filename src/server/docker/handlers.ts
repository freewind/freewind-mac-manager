import {
  type PublicErrorStatus,
  PublicOperationError,
  publicSystemError,
} from "@server/common/public-error"
import { toTaskHttpResponse } from "@server/common/tasks/response"
import {
  DOCKER_ACTION_KIND,
  type DockerActionPayload,
} from "@server/docker/task"
import type { TaskRuntime } from "@server/tasks/runtime"
import {
  type ActionResponse,
  contract,
  type DockerContainerActionBody,
  TASK_REQUEST_ID_HEADER,
} from "@shared/api-contract"
import { ActionResponseSchema } from "@shared/api-contract/schemas/common"
import { dockerContainerTaskTarget } from "@shared/task-targets"
import { initServer } from "@ts-rest/express"
import { DockerCommandError, isMissingContainerError } from "./cli"
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
}

/** 只读端点没有「创建」与「状态冲突」语义，409 一律收敛成 500。 */
const toReadStatus = (status: PublicErrorStatus): 400 | 403 | 404 | 500 =>
  status === 409 ? 500 : status

const statusOf = (error: DockerCommandError): PublicErrorStatus => {
  if (error.kind === "invalid_input") return 400
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
const submitContainerAction = async (
  runtime: TaskRuntime,
  options: {
    payload: DockerActionPayload
    /** 冲突锁按容器 id：同容器互斥，不同容器可并行 */
    containerId: string
    requestId: string
  }
) => {
  const outcome = await runtime.runner.submit<ActionResponse>({
    kind: DOCKER_ACTION_KIND,
    target: dockerContainerTaskTarget(options.containerId),
    payload: options.payload,
    requestId: options.requestId,
    toCompletedResponse: (result) => {
      const parsed = ActionResponseSchema.safeParse(result.result)
      if (!parsed.success) {
        throw new Error("容器动作结果不符合契约，无法作为完成结果返回")
      }
      return { status: 200, body: parsed.data }
    },
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
        if ((await service.findContainer(body.containerId)) === null) {
          return {
            status: 404 as const,
            body: { message: "容器不存在，请重新读取列表" },
          }
        }
        return await submitContainerAction(runtime, {
          payload: containerActionPayload(body),
          containerId: body.containerId,
          requestId: headers[TASK_REQUEST_ID_HEADER],
        })
      } catch (error) {
        return failWrite(error)
      }
    },

    removeDockerContainer: async ({ headers, body }) => {
      try {
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
          containerId: body.containerId,
          requestId: headers[TASK_REQUEST_ID_HEADER],
        })
      } catch (error) {
        return failWrite(error)
      }
    },
  })
