import type {
  KillProcessesBody,
  KillProcessesResponse,
  ProcessListResponse,
} from "@shared/api-contract"
import { apiClient } from "./client"

const unwrap = <T>(result: { status: number; body: unknown }): T => {
  if (result.status >= 200 && result.status < 300) return result.body as T
  const body = result.body as { message?: string } | undefined
  throw new Error(body?.message ?? `请求失败（HTTP ${result.status}）`)
}

/** 读取本机当前全部进程与整机概览。 */
export const fetchProcessList = async (): Promise<ProcessListResponse> =>
  unwrap<ProcessListResponse>(await apiClient.listProcesses())

/** 结束进程：force 为真时发 SIGKILL，否则发 SIGTERM。 */
export const killProcesses = async (
  input: KillProcessesBody
): Promise<KillProcessesResponse> =>
  unwrap<KillProcessesResponse>(await apiClient.killProcesses({ body: input }))
