import type {
  ActionResponse,
  DockerContainerActionBody,
  DockerContainerDeleteBody,
} from "@shared/api-contract"
import { apiClient, taskRequestHeaders } from "./client"
import { type Execution, runExecution } from "./execution"

/**
 * 容器动作都由请求标识驱动：服务端据此复用任务，重发不会变成第二次执行。
 * 命令执行完只说明命令跑完了，是否真的生效由列表重新读取确认。
 */
export const actOnDockerContainer = async (
  requestId: string,
  body: DockerContainerActionBody
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.actOnDockerContainer({
      body,
      headers: taskRequestHeaders(requestId),
    })
  )

/** 删除容器：运行中的容器不带 force 会被服务端拒绝（409），不会偷偷加 -f。 */
export const removeDockerContainer = async (
  requestId: string,
  body: DockerContainerDeleteBody
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.removeDockerContainer({
      body,
      headers: taskRequestHeaders(requestId),
    })
  )
