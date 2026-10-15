import type {
  McpCallRecord,
  McpConnectionState,
  McpLogsResponse,
  McpPromptGetInput,
  McpResourceReadInput,
  McpServerInput,
  McpServersResponse,
  McpToolCallInput,
} from "@shared/api-contract"
import {
  callMcpTool,
  connectMcpServer,
  createMcpServer,
  deleteMcpServer,
  disconnectMcpServer,
  fetchMcpCalls,
  fetchMcpLogs,
  fetchMcpServers,
  getMcpPrompt,
  readMcpResource,
  updateMcpServer,
} from "@shared/client-api"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

/**
 * MCP Servers 页的数据访问层。
 *
 * 远程状态一律归 TanStack Query，组件不直接调 client-api。写操作都不自动重试：
 * 连接会启动本机进程，调用可能有副作用，失败或超时都不能悄悄重放。
 */

export const mcpServerKeys = {
  all: ["mcp-servers"] as const,
  list: () => [...mcpServerKeys.all, "list"] as const,
  calls: (serverId: string | null) =>
    [...mcpServerKeys.all, "calls", serverId ?? "all"] as const,
  logs: (serverId: string) => [...mcpServerKeys.all, "logs", serverId] as const,
}

export const useMcpServersQuery = () =>
  useQuery({
    queryKey: mcpServerKeys.list(),
    queryFn: () => fetchMcpServers(),
    // 连接状态只由本页的动作改变，没有外部变化源，不需要轮询。
    retry: false,
  })

export const useMcpCallsQuery = (serverId: string | null) =>
  useQuery({
    queryKey: mcpServerKeys.calls(serverId),
    queryFn: () => fetchMcpCalls(serverId === null ? {} : { serverId }),
    retry: false,
  })

/** 子进程 stderr 尾部：只在需要时读，不轮询。 */
export const useMcpLogsQuery = (serverId: string, enabled: boolean) =>
  useQuery<McpLogsResponse>({
    queryKey: mcpServerKeys.logs(serverId),
    queryFn: () => fetchMcpLogs(serverId),
    enabled,
    retry: false,
  })

/**
 * 连接状态是本地乐观更新的：动作期间立刻显示「连接中」或「未连接」，
 * 结束后以服务端返回的真实状态为准。
 */
const patchState = (
  queryClient: ReturnType<typeof useQueryClient>,
  serverId: string,
  state: McpConnectionState
): void => {
  queryClient.setQueryData<McpServersResponse>(
    mcpServerKeys.list(),
    (previous) =>
      previous === undefined
        ? previous
        : {
            ...previous,
            servers: previous.servers.map((item) =>
              item.config.id === serverId
                ? {
                    ...item,
                    status: { ...item.status, state, lastError: null },
                  }
                : item
            ),
          }
  )
}

const invalidateList = (queryClient: ReturnType<typeof useQueryClient>) => {
  void queryClient.invalidateQueries({ queryKey: mcpServerKeys.list() })
}

export const useConnectMcpServer = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (serverId: string) => connectMcpServer(serverId),
    retry: false,
    onMutate: (serverId: string) =>
      patchState(queryClient, serverId, "connecting"),
    onSettled: () => invalidateList(queryClient),
  })
}

export const useDisconnectMcpServer = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (serverId: string) => disconnectMcpServer(serverId),
    retry: false,
    onMutate: (serverId: string) =>
      patchState(queryClient, serverId, "disconnected"),
    onSettled: () => invalidateList(queryClient),
  })
}

export const useCreateMcpServer = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: McpServerInput) => createMcpServer(input),
    retry: false,
    onSuccess: () => invalidateList(queryClient),
  })
}

export const useUpdateMcpServer = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { serverId: string; config: McpServerInput }) =>
      updateMcpServer(input.serverId, input.config),
    retry: false,
    onSuccess: () => invalidateList(queryClient),
  })
}

export const useDeleteMcpServer = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (serverId: string) => deleteMcpServer(serverId),
    retry: false,
    onSuccess: () => {
      invalidateList(queryClient)
      void queryClient.invalidateQueries({
        queryKey: mcpServerKeys.calls(null),
      })
    },
  })
}

/**
 * 调用类动作：无论成功还是失败都会在服务端留下一条记录（连接层面的失败除外），
 * 所以结束后统一刷新列表与记录。
 */
const useCallMutation = <TInput>(
  run: (input: TInput) => Promise<McpCallRecord>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: run,
    // 调用可能已经执行过：失败或超时都不自动重试。
    retry: false,
    networkMode: "always",
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: mcpServerKeys.all })
    },
  })
}

export const useCallMcpTool = () =>
  useCallMutation((input: { serverId: string; request: McpToolCallInput }) =>
    callMcpTool(input.serverId, input.request)
  )

export const useReadMcpResource = () =>
  useCallMutation(
    (input: { serverId: string; request: McpResourceReadInput }) =>
      readMcpResource(input.serverId, input.request)
  )

export const useGetMcpPrompt = () =>
  useCallMutation((input: { serverId: string; request: McpPromptGetInput }) =>
    getMcpPrompt(input.serverId, input.request)
  )
