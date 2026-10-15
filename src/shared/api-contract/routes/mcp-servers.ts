import { ApiPath, toContractPath } from "@shared/api-path"
import { c } from "../init"
import { ApiErrorSchema } from "../schemas/common"
import {
  McpCallRecordSchema,
  McpCallsQuerySchema,
  McpCallsResponseSchema,
  McpCapabilitiesResponseSchema,
  McpLogsResponseSchema,
  McpPromptGetInputSchema,
  McpResourceReadInputSchema,
  McpServerIdPathParamsSchema,
  McpServerInputSchema,
  McpServerSchema,
  McpServersResponseSchema,
  McpToolCallInputSchema,
} from "../schemas/mcp-servers"

const errorResponses = {
  400: ApiErrorSchema,
  403: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  500: ApiErrorSchema,
} as const

/**
 * MCP Servers 域的路由。
 *
 * 读接口只读；配置写入是本地快速写；连接与调用会真的启动进程或访问网络，
 * 因此都显式声明 409（未连接、名称冲突、重复提交、未确认的危险动作）。
 */
export const mcpServersRoutes = {
  // 服务器列表：配置 + 当前运行状态 + 能力快照；只读。
  listMcpServers: {
    method: "GET",
    path: toContractPath(ApiPath.mcpServers),
    responses: {
      200: McpServersResponseSchema,
      ...errorResponses,
    },
  },
  // 调用记录（全部或按服务器过滤）；只读。
  listMcpCalls: {
    method: "GET",
    path: toContractPath(ApiPath.mcpServerCalls),
    query: McpCallsQuerySchema,
    responses: {
      200: McpCallsResponseSchema,
      ...errorResponses,
    },
  },
  // 新增配置只写数据库，不会启动进程；写完仍是未连接状态。
  createMcpServer: {
    method: "POST",
    path: toContractPath(ApiPath.mcpServers),
    body: McpServerInputSchema,
    responses: {
      201: McpServerSchema,
      ...errorResponses,
    },
  },
  updateMcpServer: {
    method: "PATCH",
    path: toContractPath(ApiPath.mcpServer),
    pathParams: McpServerIdPathParamsSchema,
    body: McpServerInputSchema,
    responses: {
      200: McpServerSchema,
      ...errorResponses,
    },
  },
  deleteMcpServer: {
    method: "DELETE",
    path: toContractPath(ApiPath.mcpServer),
    pathParams: McpServerIdPathParamsSchema,
    responses: { 204: null, ...errorResponses },
  },
  // 连接会按配置启动本机进程或访问远程地址；失败是业务结果，仍回 200。
  connectMcpServer: {
    method: "POST",
    path: toContractPath(ApiPath.mcpServerConnect),
    pathParams: McpServerIdPathParamsSchema,
    body: c.noBody(),
    responses: {
      200: McpServerSchema,
      ...errorResponses,
    },
  },
  disconnectMcpServer: {
    method: "POST",
    path: toContractPath(ApiPath.mcpServerDisconnect),
    pathParams: McpServerIdPathParamsSchema,
    body: c.noBody(),
    responses: {
      200: McpServerSchema,
      ...errorResponses,
    },
  },
  // 能力清单：连接时实时读取，未连接时返回上次缓存并标记 stale。
  getMcpCapabilities: {
    method: "GET",
    path: toContractPath(ApiPath.mcpServerCapabilities),
    pathParams: McpServerIdPathParamsSchema,
    responses: {
      200: McpCapabilitiesResponseSchema,
      ...errorResponses,
    },
  },
  // 子进程 stderr 尾部；只读，仅用于排错。
  getMcpLogs: {
    method: "GET",
    path: toContractPath(ApiPath.mcpServerLogs),
    pathParams: McpServerIdPathParamsSchema,
    responses: {
      200: McpLogsResponseSchema,
      ...errorResponses,
    },
  },
  // 工具名放在 body 而不是路径：MCP 不限制工具名的字符集，放路径要额外转义。
  callMcpTool: {
    method: "POST",
    path: toContractPath(ApiPath.mcpServerToolCall),
    pathParams: McpServerIdPathParamsSchema,
    body: McpToolCallInputSchema,
    responses: {
      200: McpCallRecordSchema,
      ...errorResponses,
    },
  },
  readMcpResource: {
    method: "POST",
    path: toContractPath(ApiPath.mcpServerResourceRead),
    pathParams: McpServerIdPathParamsSchema,
    body: McpResourceReadInputSchema,
    responses: {
      200: McpCallRecordSchema,
      ...errorResponses,
    },
  },
  getMcpPrompt: {
    method: "POST",
    path: toContractPath(ApiPath.mcpServerPromptGet),
    pathParams: McpServerIdPathParamsSchema,
    body: McpPromptGetInputSchema,
    responses: {
      200: McpCallRecordSchema,
      ...errorResponses,
    },
  },
} as const
