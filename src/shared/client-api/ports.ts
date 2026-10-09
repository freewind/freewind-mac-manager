import type {
  KillPortProcessesBody,
  KillPortProcessesResponse,
  PortBindingsResponse,
} from "@shared/api-contract"
import { apiClient, unwrap } from "./client"

/** 读取本机当前全部 TCP / UDP 套接字绑定。 */
export const fetchPortBindings = async (): Promise<PortBindingsResponse> =>
  unwrap<PortBindingsResponse>(await apiClient.listPortBindings())

/** 结束确实占用指定端口的进程；未占用该端口的 PID 会被跳过。 */
export const killPortProcesses = async (
  input: KillPortProcessesBody
): Promise<KillPortProcessesResponse> =>
  unwrap<KillPortProcessesResponse>(
    await apiClient.killPortProcesses({ body: input })
  )
