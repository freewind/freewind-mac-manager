import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  callTool,
  connectServer,
  createServer,
  deleteServer,
  disconnectServer,
  getPrompt,
  listCalls,
  listServers,
  readResource,
  updateServer,
} from "./mock/mock-api"
import type {
  McpCallRecord,
  McpConnectionState,
  McpServer,
  McpServerInput,
} from "./types"

/**
 * MCP Servers 页的数据访问层。
 *
 * 当前指向演示用的内存实现（`./mock/mock-api`）。页面只依赖这里导出的
 * query/mutation，不直接碰 mock 模块；接真实后端时替换这一层的实现即可。
 */

export const mcpServerKeys = {
  all: ["mcp-servers"] as const,
  list: () => [...mcpServerKeys.all, "list"] as const,
  calls: (serverId: string | null) =>
    [...mcpServerKeys.all, "calls", serverId ?? "all"] as const,
}

export const useMcpServersQuery = () =>
  useQuery({
    queryKey: mcpServerKeys.list(),
    queryFn: () => listServers(),
    // 演示数据没有外部变化源，不轮询；所有改动都由本页动作触发失效。
    retry: false,
  })

export const useMcpCallsQuery = (serverId: string | null) =>
  useQuery({
    queryKey: mcpServerKeys.calls(serverId),
    queryFn: () => listCalls(serverId),
    retry: false,
  })

/** 连接状态是本地乐观更新的：动作期间立刻显示「连接中」，结束后以服务端结果为准。 */
const patchState = (
  queryClient: ReturnType<typeof useQueryClient>,
  serverId: string,
  state: McpConnectionState
): void => {
  queryClient.setQueryData<McpServer[]>(mcpServerKeys.list(), (previous) =>
    previous?.map((item) =>
      item.config.id === serverId
        ? { ...item, status: { ...item.status, state, lastError: null } }
        : item
    )
  )
}

export const useConnectMcpServer = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (serverId: string) => connectServer(serverId),
    // 连接不是幂等的重放动作：失败就让用户自己再点一次。
    retry: false,
    onMutate: (serverId: string) =>
      patchState(queryClient, serverId, "connecting"),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: mcpServerKeys.list() })
    },
  })
}

export const useDisconnectMcpServer = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (serverId: string) => disconnectServer(serverId),
    retry: false,
    onMutate: (serverId: string) =>
      patchState(queryClient, serverId, "disconnected"),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: mcpServerKeys.list() })
    },
  })
}

export const useCreateMcpServer = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: McpServerInput) => createServer(input),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mcpServerKeys.list() })
    },
  })
}

export const useUpdateMcpServer = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { serverId: string; config: McpServerInput }) =>
      updateServer(input.serverId, input.config),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mcpServerKeys.list() })
    },
  })
}

export const useDeleteMcpServer = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (serverId: string) => deleteServer(serverId),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mcpServerKeys.list() })
      void queryClient.invalidateQueries({
        queryKey: mcpServerKeys.calls(null),
      })
    },
  })
}

/** 调用结果无论成功失败都会产生一条记录，因此统一在结束后刷新记录列表。 */
const useCallMutation = <TInput, TOutput extends McpCallRecord>(
  run: (input: TInput) => Promise<TOutput>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: run,
    // 调用可能有副作用且可能已执行：失败或超时都不自动重试。
    retry: false,
    networkMode: "always",
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: mcpServerKeys.all })
    },
  })
}

export const useCallMcpTool = () =>
  useCallMutation(
    (input: {
      serverId: string
      toolName: string
      args: Record<string, unknown>
    }) => callTool(input.serverId, input.toolName, input.args)
  )

export const useReadMcpResource = () =>
  useCallMutation((input: { serverId: string; uri: string }) =>
    readResource(input.serverId, input.uri)
  )

export const useGetMcpPrompt = () =>
  useCallMutation(
    (input: {
      serverId: string
      name: string
      args: Record<string, unknown>
    }) => getPrompt(input.serverId, input.name, input.args)
  )
