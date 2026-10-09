import type {
  KillProcessesBody,
  KillProcessesResponse,
  ProcessListResponse,
} from "@shared/api-contract"
import { apiClient, unwrap } from "./client"

/** 读取本机当前全部进程与整机概览。 */
export const fetchProcessList = async (): Promise<ProcessListResponse> =>
  unwrap<ProcessListResponse>(await apiClient.listProcesses())

/** 结束进程：force 为真时发 SIGKILL，否则发 SIGTERM。 */
export const killProcesses = async (
  input: KillProcessesBody
): Promise<KillProcessesResponse> =>
  unwrap<KillProcessesResponse>(await apiClient.killProcesses({ body: input }))
