import { randomUUID } from "node:crypto"
import { PublicOperationError } from "@server/common/public-error"
import type {
  McpCallKind,
  McpCallRecord,
  McpCallsQueryInput,
  McpCallsResponse,
  McpCapabilities,
  McpCapabilitiesResponse,
  McpLogsResponse,
  McpPromptGetInput,
  McpResourceReadInput,
  McpServer,
  McpServerConfig,
  McpServerInput,
  McpServersResponse,
  McpToolCallInput,
} from "@shared/api-contract"
import { MCP_CALLS_DEFAULT_LIMIT, MCP_CALLS_MAX_LIMIT } from "./limits"
import {
  type McpCallOutcome,
  type McpRuntime,
  McpRuntimeError,
} from "./runtime"
import type { McpServerStore } from "./store"

/**
 * MCP Servers 域服务。
 *
 * handler 只做入参到这里的映射；配置校验、危险动作拦截、错误语义与调用记录
 * 都在这一层。store 负责落库，runtime 负责真实连接，本层不碰 sqlite 也不碰
 * 子进程。
 */

const NUL = "\u0000"

/** 去掉空键的行、去空白并丢掉空标签；顺带拒绝含 NUL 的字符串。 */
const sanitizeInput = (input: McpServerInput): McpServerInput => {
  const name = input.name.trim()
  const description = input.description.trim()
  const command = input.command.trim()
  const url = input.url.trim()
  const cwd = input.cwd === null ? null : input.cwd.trim()

  const strings = [
    name,
    description,
    command,
    url,
    cwd ?? "",
    ...input.args,
    ...input.env.flatMap((item) => [item.key, item.value]),
    ...input.headers.flatMap((item) => [item.key, item.value]),
    ...input.tags,
  ]
  if (strings.some((value) => value.includes(NUL))) {
    throw new PublicOperationError(400, "配置里包含非法字符，无法保存。")
  }

  if (name === "") throw new PublicOperationError(400, "请填写服务器名称。")

  if (input.transport === "stdio") {
    if (command === "") {
      throw new PublicOperationError(400, "stdio 服务器必须填写启动命令。")
    }
    if (cwd !== null && cwd !== "" && !cwd.startsWith("/")) {
      throw new PublicOperationError(400, "工作目录必须是绝对路径。")
    }
  } else {
    if (url === "") {
      throw new PublicOperationError(400, "远程服务器必须填写服务地址。")
    }
    if (!/^https?:\/\//.test(url)) {
      throw new PublicOperationError(
        400,
        "服务地址必须以 http:// 或 https:// 开头。"
      )
    }
  }

  const rows = (items: { key: string; value: string }[]) =>
    items
      .map((item) => ({ key: item.key.trim(), value: item.value }))
      .filter((item) => item.key !== "")

  return {
    name,
    description,
    transport: input.transport,
    command: input.transport === "stdio" ? command : "",
    args:
      input.transport === "stdio" ? input.args.map((item) => item.trim()) : [],
    cwd: input.transport === "stdio" && cwd !== "" ? cwd : null,
    env: input.transport === "stdio" ? rows(input.env) : [],
    url: input.transport === "http" ? url : "",
    headers: input.transport === "http" ? rows(input.headers) : [],
    enabled: input.enabled,
    tags: input.tags.map((tag) => tag.trim()).filter((tag) => tag !== ""),
    // 秒数由 schema 限定在 1–3600；null 表示用默认值。
    timeoutSeconds: input.timeoutSeconds,
  }
}

/** 传输方式、命令、参数或地址变了就等于换了目标，旧能力快照不能再算数。 */
const targetChanged = (
  before: McpServerConfig,
  after: McpServerInput
): boolean =>
  before.transport !== after.transport ||
  before.command !== after.command ||
  before.url !== after.url ||
  JSON.stringify(before.args) !== JSON.stringify(after.args)

export type McpServersService = {
  listServers: () => McpServersResponse
  listCalls: (query: McpCallsQueryInput) => McpCallsResponse
  createServer: (input: McpServerInput) => McpServer
  updateServer: (id: string, input: McpServerInput) => Promise<McpServer>
  deleteServer: (id: string) => Promise<void>
  connectServer: (id: string) => Promise<McpServer>
  disconnectServer: (id: string) => Promise<McpServer>
  getCapabilities: (id: string) => McpCapabilitiesResponse
  getLogs: (id: string) => McpLogsResponse
  callTool: (id: string, input: McpToolCallInput) => Promise<McpCallRecord>
  readResource: (
    id: string,
    input: McpResourceReadInput
  ) => Promise<McpCallRecord>
  getPrompt: (id: string, input: McpPromptGetInput) => Promise<McpCallRecord>
  shutdown: () => Promise<void>
}

export const createMcpServersService = (deps: {
  store: McpServerStore
  runtime: McpRuntime
}): McpServersService => {
  const { store, runtime } = deps

  const requireConfig = (id: string): McpServerConfig => {
    const config = store.findConfig(id)
    if (config === null) {
      throw new PublicOperationError(404, "这台服务器不存在，可能已经被删除。")
    }
    return config
  }

  /**
   * 能力清单：已连接时用内存里的实时清单，未连接时一律以库里的快照为准。
   * 以库为准是因为「改了传输方式或地址」会把快照清空，而运行时为了支持
   * 「断开后仍可查看」会故意留着内存里的旧清单，那种情况不该再拿出来用。
   */
  const capabilitiesOf = (id: string): McpCapabilities | null => {
    const live =
      runtime.snapshot(id).state === "connected"
        ? runtime.capabilities(id)
        : null
    return live ?? store.readCapabilities(id)
  }

  const toServer = (config: McpServerConfig): McpServer => {
    const snapshot = runtime.snapshot(config.id)
    return {
      config,
      status: {
        state: snapshot.state,
        connectedAt: snapshot.connectedAt,
        lastError: snapshot.lastError,
      },
      serverInfo: snapshot.serverInfo,
      capabilities: capabilitiesOf(config.id),
    }
  }

  const requireConnected = (config: McpServerConfig): void => {
    if (runtime.snapshot(config.id).state !== "connected") {
      throw new PublicOperationError(
        409,
        `服务器「${config.name}」未连接，无法调用；请先连接后再试。`
      )
    }
  }

  const recordCall = (input: {
    config: McpServerConfig
    kind: McpCallKind
    name: string
    request: unknown
    startedAt: number
    outcome: McpCallOutcome
  }): McpCallRecord => {
    const record: McpCallRecord = {
      id: randomUUID(),
      serverId: input.config.id,
      serverName: input.config.name,
      kind: input.kind,
      name: input.name,
      status: input.outcome.status,
      startedAt: input.startedAt,
      durationMs: input.outcome.durationMs,
      request: input.request,
      content: input.outcome.content,
      error: input.outcome.error,
    }
    store.insertCall(record)
    store.pruneCalls(input.config.id)
    return record
  }

  /**
   * 运行时层的拒绝（未连接、正在连接、重复提交）都是状态冲突，统一映射成 409；
   * 其余异常交给 handler 的公共兜底。
   */
  const mapRuntimeError = (error: unknown): never => {
    if (error instanceof McpRuntimeError) {
      throw new PublicOperationError(409, error.message)
    }
    throw error
  }

  return {
    listServers: () => ({
      servers: store.listConfigs().map(toServer),
      readAt: Date.now(),
    }),

    listCalls: (query) => {
      const limit = Math.min(
        query.limit ?? MCP_CALLS_DEFAULT_LIMIT,
        MCP_CALLS_MAX_LIMIT
      )
      return {
        calls: store.listCalls({
          serverId: query.serverId ?? null,
          limit,
        }),
        limit,
      }
    },

    createServer: (input) => {
      const clean = sanitizeInput(input)
      if (store.findConfigByName(clean.name, null) !== null) {
        throw new PublicOperationError(
          409,
          `已经有一台叫「${clean.name}」的服务器。`
        )
      }
      // 只写配置，不启动进程；连接是另一个显式动作。
      return toServer(store.createConfig(clean))
    },

    updateServer: async (id, input) => {
      const before = requireConfig(id)
      const clean = sanitizeInput(input)
      if (store.findConfigByName(clean.name, id) !== null) {
        throw new PublicOperationError(
          409,
          `已经有一台叫「${clean.name}」的服务器。`
        )
      }
      const updated = store.updateConfig(id, clean)
      if (updated === null) {
        throw new PublicOperationError(
          404,
          "这台服务器不存在，可能已经被删除。"
        )
      }
      if (targetChanged(before, clean)) {
        // 换了目标：旧连接与旧能力快照都不能再代表这台服务器。
        await runtime.disconnect(id)
        store.clearCapabilities(id)
      }
      return toServer(updated)
    },

    deleteServer: async (id) => {
      requireConfig(id)
      await runtime.disconnect(id)
      if (!store.deleteConfig(id)) {
        throw new PublicOperationError(
          404,
          "这台服务器不存在，可能已经被删除。"
        )
      }
    },

    connectServer: async (id) => {
      const config = requireConfig(id)
      let result: Awaited<ReturnType<McpRuntime["connect"]>>
      try {
        result = await runtime.connect(config)
      } catch (error) {
        return mapRuntimeError(error)
      }
      // 只有真的连上才刷新能力快照；失败时保留上一次的快照，页面会标注可能过期。
      if (
        result.snapshot.state === "connected" &&
        result.capabilities !== null
      ) {
        store.saveCapabilities(id, result.capabilities)
      }
      return toServer(store.findConfig(id) ?? config)
    },

    disconnectServer: async (id) => {
      const config = requireConfig(id)
      await runtime.disconnect(id)
      return toServer(config)
    },

    getCapabilities: (id) => {
      requireConfig(id)
      const connected = runtime.snapshot(id).state === "connected"
      return {
        capabilities: capabilitiesOf(id),
        stale: !connected,
        connected,
      }
    },

    getLogs: (id) => {
      requireConfig(id)
      return runtime.logs(id)
    },

    callTool: async (id, input) => {
      const config = requireConfig(id)
      requireConnected(config)
      const tool = capabilitiesOf(id)?.tools.find(
        (item) => item.name === input.toolName
      )
      if (tool === undefined) {
        throw new PublicOperationError(
          404,
          `服务器「${config.name}」没有声明工具「${input.toolName}」；能力清单可能已过期，请重新连接后再试。`
        )
      }
      // 前端确认不是安全边界：这里再拦一次，没带确认标记就不执行。
      if (tool.annotations.destructive && !input.acknowledgedRisk) {
        throw new PublicOperationError(
          409,
          `工具「${tool.name}」可能改动外部状态，需要显式确认后才能执行。`
        )
      }
      const startedAt = Date.now()
      let outcome: McpCallOutcome
      try {
        outcome = await runtime.callTool(id, tool.name, input.args)
      } catch (error) {
        return mapRuntimeError(error)
      }
      return recordCall({
        config,
        kind: "tool",
        name: tool.name,
        request: input.args,
        startedAt,
        outcome,
      })
    },

    readResource: async (id, input) => {
      const config = requireConfig(id)
      requireConnected(config)
      const capabilities = capabilitiesOf(id)
      const declared =
        capabilities?.resources.find((item) => item.uri === input.uri) ??
        capabilities?.resourceTemplates.find((item) =>
          input.uri.startsWith(item.uriTemplate.split("{")[0])
        )
      if (declared === undefined) {
        throw new PublicOperationError(
          404,
          `服务器「${config.name}」没有声明资源「${input.uri}」；能力清单可能已过期，请重新连接后再试。`
        )
      }
      const startedAt = Date.now()
      let outcome: McpCallOutcome
      try {
        outcome = await runtime.readResource(id, input.uri)
      } catch (error) {
        return mapRuntimeError(error)
      }
      return recordCall({
        config,
        kind: "resource",
        name: declared.name,
        request: { uri: input.uri },
        startedAt,
        outcome,
      })
    },

    getPrompt: async (id, input) => {
      const config = requireConfig(id)
      requireConnected(config)
      const declared = capabilitiesOf(id)?.prompts.find(
        (item) => item.name === input.name
      )
      if (declared === undefined) {
        throw new PublicOperationError(
          404,
          `服务器「${config.name}」没有声明提示词「${input.name}」；能力清单可能已过期，请重新连接后再试。`
        )
      }
      const startedAt = Date.now()
      let outcome: McpCallOutcome
      try {
        outcome = await runtime.getPrompt(id, input.name, input.args)
      } catch (error) {
        return mapRuntimeError(error)
      }
      return recordCall({
        config,
        kind: "prompt",
        name: declared.name,
        request: input.args,
        startedAt,
        outcome,
      })
    },

    shutdown: () => runtime.shutdown(),
  }
}
