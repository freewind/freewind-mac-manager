import type {
  ActionResponse,
  ServiceDomain,
  ServicesResponse,
} from "@shared/api-contract"
import { apiClient, taskRequestHeaders, unwrap } from "./client"
import { type Execution, runExecution } from "./execution"

type ServiceTarget = { label: string; domain: ServiceDomain }

export const fetchSystemServices = async (): Promise<ServicesResponse> =>
  unwrap<ServicesResponse>(await apiClient.listSystemServices())

/**
 * 服务动作都由请求标识驱动：服务端据此复用任务，重发不会变成第二次执行。
 * 命令执行完只说明命令跑完了，是否真的运行/停止由列表重新读取确认。
 */
export const startSystemService = async (
  requestId: string,
  target: ServiceTarget
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.startSystemService({
      body: target,
      headers: taskRequestHeaders(requestId),
    })
  )

export const stopSystemService = async (
  requestId: string,
  target: ServiceTarget
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.stopSystemService({
      query: target,
      headers: taskRequestHeaders(requestId),
    })
  )

export const restartSystemService = async (
  requestId: string,
  target: ServiceTarget
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.restartSystemService({
      body: target,
      headers: taskRequestHeaders(requestId),
    })
  )

export const loadSystemService = async (
  requestId: string,
  target: ServiceTarget
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.loadSystemService({
      body: target,
      headers: taskRequestHeaders(requestId),
    })
  )

export const uninstallSystemService = async (
  requestId: string,
  target: ServiceTarget
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.uninstallSystemService({
      query: target,
      headers: taskRequestHeaders(requestId),
    })
  )

export const setSystemServiceEnabled = async (
  requestId: string,
  target: ServiceTarget & { disabled: boolean }
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.setSystemServiceEnabled({
      body: target,
      headers: taskRequestHeaders(requestId),
    })
  )

export const revealSystemService = async (
  requestId: string,
  target: ServiceTarget
): Promise<Execution<ActionResponse>> =>
  runExecution<ActionResponse>(() =>
    apiClient.revealSystemService({
      body: target,
      headers: taskRequestHeaders(requestId),
    })
  )
