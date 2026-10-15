import type {
  McpCallRecord,
  McpCallsQueryInput,
  McpCallsResponse,
  McpCapabilitiesResponse,
  McpLogsResponse,
  McpPromptGetInput,
  McpResourceReadInput,
  McpServer,
  McpServerInput,
  McpServersResponse,
  McpToolCallInput,
} from "@shared/api-contract"
import { apiClient, unwrap } from "./client"

/** 服务器列表：配置 + 当前运行状态 + 能力快照。 */
export const fetchMcpServers = async (): Promise<McpServersResponse> =>
  unwrap<McpServersResponse>(await apiClient.listMcpServers())

/** 调用记录，可按服务器过滤；不传 serverId 时返回全部。 */
export const fetchMcpCalls = async (
  query: McpCallsQueryInput
): Promise<McpCallsResponse> =>
  unwrap<McpCallsResponse>(await apiClient.listMcpCalls({ query }))

/** 能力清单：连接时是实时读取，未连接时是缓存并带 stale 标记。 */
export const fetchMcpCapabilities = async (
  id: string
): Promise<McpCapabilitiesResponse> =>
  unwrap<McpCapabilitiesResponse>(
    await apiClient.getMcpCapabilities({ params: { id } })
  )

/** 子进程 stderr 尾部，用于排错。 */
export const fetchMcpLogs = async (id: string): Promise<McpLogsResponse> =>
  unwrap<McpLogsResponse>(await apiClient.getMcpLogs({ params: { id } }))

export const createMcpServer = async (
  input: McpServerInput
): Promise<McpServer> =>
  unwrap<McpServer>(await apiClient.createMcpServer({ body: input }))

export const updateMcpServer = async (
  id: string,
  input: McpServerInput
): Promise<McpServer> =>
  unwrap<McpServer>(
    await apiClient.updateMcpServer({ params: { id }, body: input })
  )

export const deleteMcpServer = async (id: string): Promise<void> => {
  unwrap<null>(await apiClient.deleteMcpServer({ params: { id } }))
}

/**
 * 连接：会按配置启动本机进程或访问远程地址。
 * 连不上是业务结果（返回 failed 状态与原因），不是请求失败。
 */
export const connectMcpServer = async (id: string): Promise<McpServer> =>
  unwrap<McpServer>(await apiClient.connectMcpServer({ params: { id } }))

export const disconnectMcpServer = async (id: string): Promise<McpServer> =>
  unwrap<McpServer>(await apiClient.disconnectMcpServer({ params: { id } }))

/** 调用工具；可能产生副作用，失败与超时都不自动重试。 */
export const callMcpTool = async (
  id: string,
  input: McpToolCallInput
): Promise<McpCallRecord> =>
  unwrap<McpCallRecord>(
    await apiClient.callMcpTool({ params: { id }, body: input })
  )

export const readMcpResource = async (
  id: string,
  input: McpResourceReadInput
): Promise<McpCallRecord> =>
  unwrap<McpCallRecord>(
    await apiClient.readMcpResource({ params: { id }, body: input })
  )

export const getMcpPrompt = async (
  id: string,
  input: McpPromptGetInput
): Promise<McpCallRecord> =>
  unwrap<McpCallRecord>(
    await apiClient.getMcpPrompt({ params: { id }, body: input })
  )
