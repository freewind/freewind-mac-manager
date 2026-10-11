import {
  type PublicErrorStatus,
  PublicOperationError,
  publicSystemError,
} from "@server/common/public-error"
import { contract } from "@shared/api-contract"
import { initServer } from "@ts-rest/express"
import { DockerCommandError, isMissingContainerError } from "./cli"
import type { DockerService } from "./service"

const s = initServer()

/** 只挑本功能的只读路由；写操作由后续任务往同一 router 里追加。 */
export const dockerContract = {
  getDockerOverview: contract.getDockerOverview,
  listDockerContainers: contract.listDockerContainers,
  getDockerContainerLogs: contract.getDockerContainerLogs,
  listDockerImages: contract.listDockerImages,
  listDockerVolumes: contract.listDockerVolumes,
  listDockerNetworks: contract.listDockerNetworks,
  getDockerColimaStatus: contract.getDockerColimaStatus,
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
const fail = (
  error: unknown
): { status: 400 | 403 | 404 | 500; body: { message: string } } => {
  const mapped =
    error instanceof DockerCommandError
      ? publicSystemError(
          new PublicOperationError(statusOf(error), messageOf(error))
        )
      : publicSystemError(error)
  return { status: toReadStatus(mapped.status), body: mapped.body }
}

export const createDockerRouter = (service: DockerService) =>
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
  })
