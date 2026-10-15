import {
  McpAbortError,
  McpAuthRequiredError,
  McpClient,
  McpConnectionClosedError,
  McpError,
  McpHttpError,
  McpSessionExpiredError,
  McpTimeoutError,
  type McpTransport,
  StdioTransport,
  StreamableHttpTransport,
} from "@earendil-works/pi-mcp"
import type {
  McpCallStatus,
  McpCapabilities,
  McpConnectionState,
  McpContentBlock,
  McpServerConfig,
  McpServerInfo,
} from "@shared/api-contract"
import {
  MCP_CLIENT_NAME,
  MCP_CLIENT_VERSION,
  MCP_CLOSE_TIMEOUT_MS,
  MCP_CONNECT_TIMEOUT_MS,
  MCP_LOG_LINES,
  MCP_MAX_MESSAGE_BYTES,
  MCP_MAX_RECORD_BYTES,
  MCP_MAX_STDERR_BYTES,
  MCP_REQUEST_TIMEOUT_MS,
} from "./limits"
import {
  normalizeCallToolResult,
  normalizeCapabilities,
  normalizeReadResourceResult,
} from "./normalize"

/**
 * MCP 连接运行时。
 *
 * 一个进程内维护 serverId 到连接的映射：连接、能力清单、stderr 尾部与最近一次
 * 失败原因都在内存里；配置与能力快照由 store 落库，这里不碰数据库。
 *
 * 子进程的回收交给 pi-mcp 的 StdioTransport：它按协议关闭（关 stdin → SIGTERM
 * → SIGKILL），并在宿主进程退出时终止仍活着的进程组，不留孤儿子进程。
 */

export type McpRuntimeErrorCode =
  | "not_connected"
  | "already_connecting"
  | "duplicate_call"
  | "disabled"

/** 运行时层面的拒绝（还没到调用服务端那一步），由服务层映射成 409。 */
export class McpRuntimeError extends Error {
  constructor(
    readonly code: McpRuntimeErrorCode,
    message: string
  ) {
    super(message)
    this.name = "McpRuntimeError"
  }
}

export type McpRuntimeSnapshot = {
  state: McpConnectionState
  serverInfo: McpServerInfo | null
  connectedAt: number | null
  lastError: string | null
}

/** 一次调用的结果；超时是 timeout-unknown，既不是成功也不是失败。 */
export type McpCallOutcome = {
  status: McpCallStatus
  content: McpContentBlock[]
  error: string | null
  durationMs: number
}

type Entry = {
  state: McpConnectionState
  client: McpClient | null
  transport: McpTransport | null
  serverInfo: McpServerInfo | null
  capabilities: McpCapabilities | null
  connectedAt: number | null
  lastError: string | null
  logText: string
  logsTruncated: boolean
  disposers: (() => void)[]
}

const newEntry = (): Entry => ({
  state: "disconnected",
  client: null,
  transport: null,
  serverInfo: null,
  capabilities: null,
  connectedAt: null,
  lastError: null,
  logText: "",
  logsTruncated: false,
  disposers: [],
})

/** 把有序键值对转成对象；空键丢掉，同名后者覆盖前者。 */
const keyValuesToRecord = (
  items: readonly { key: string; value: string }[]
): Record<string, string> => {
  const result: Record<string, string> = {}
  for (const item of items) {
    const key = item.key.trim()
    if (key !== "") result[key] = item.value
  }
  return result
}

/**
 * 把失败翻成可读的中文原因。
 * 不回传内部堆栈；命令名来自用户自己的配置，提出来是为了让错误可定位。
 */
const describeFailure = (error: unknown): string => {
  if (error instanceof McpTimeoutError) {
    return `等待超过 ${error.timeoutMs} 毫秒仍未完成。`
  }
  if (error instanceof McpAbortError) {
    return "请求已被取消。"
  }
  if (error instanceof McpAuthRequiredError) {
    return `服务端要求先完成授权（HTTP ${error.status}）。`
  }
  if (error instanceof McpSessionExpiredError) {
    return "远程会话已过期，需要重新连接。"
  }
  if (error instanceof McpHttpError) {
    return `服务端返回 HTTP ${error.status}${error.message ? `：${error.message}` : ""}`
  }
  if (error instanceof McpConnectionClosedError) {
    return "连接已关闭（服务端进程退出或网络中断）。"
  }
  if (error instanceof McpError) {
    return `服务端返回错误 ${error.code}：${error.message}`
  }
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    if (code === "ENOENT") return `找不到要启动的命令：${error.message}`
    if (code === "EACCES") return `没有执行权限：${error.message}`
    return error.message
  }
  return "未知原因"
}

/** 给一段等待加硬上限；超时后先执行清理，再以超时错误结束。 */
const withTimeout = async <T>(
  run: Promise<T>,
  milliseconds: number,
  onTimeout: () => void
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      onTimeout()
      reject(new McpTimeoutError(milliseconds))
    }, milliseconds)
  })
  try {
    return await Promise.race([run, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

const safeClose = async (target: {
  close: () => Promise<void>
}): Promise<void> => {
  try {
    await target.close()
  } catch {
    // 关闭失败不影响结果：连接已经不打算继续用了。
  }
}

export type McpRuntimeOptions = {
  /**
   * 仅测试使用：替换传输层，用 @earendil-works/pi-mcp/testing 的内存传输对
   * 做真实协议往返，不启动任何进程。
   */
  createTransport?: (
    config: McpServerConfig,
    onStderr: (chunk: string) => void
  ) => McpTransport
  /** 仅测试使用：缩短等待上限，避免为了验证超时分支真的等 60 秒。 */
  connectTimeoutMs?: number
  requestTimeoutMs?: number
}

export class McpRuntime {
  private readonly entries = new Map<string, Entry>()
  private readonly inFlight = new Set<string>()
  private readonly options: McpRuntimeOptions
  private readonly connectTimeoutMs: number
  private readonly requestTimeoutMs: number

  constructor(options: McpRuntimeOptions = {}) {
    this.options = options
    this.connectTimeoutMs = options.connectTimeoutMs ?? MCP_CONNECT_TIMEOUT_MS
    this.requestTimeoutMs = options.requestTimeoutMs ?? MCP_REQUEST_TIMEOUT_MS
  }

  /** 当前运行状态；从未连过时是未连接。 */
  snapshot(serverId: string): McpRuntimeSnapshot {
    const entry = this.entries.get(serverId)
    if (entry === undefined) {
      return {
        state: "disconnected",
        serverInfo: null,
        connectedAt: null,
        lastError: null,
      }
    }
    return {
      state: entry.state,
      serverInfo: entry.serverInfo,
      connectedAt: entry.connectedAt,
      lastError: entry.lastError,
    }
  }

  /** 内存里最近一次连接读到的能力清单；进程重启后为空，由 store 的缓存兜底。 */
  capabilities(serverId: string): McpCapabilities | null {
    return this.entries.get(serverId)?.capabilities ?? null
  }

  /** 子进程 stderr 的尾部若干行；只在内存里保留，不落库。 */
  logs(serverId: string): { lines: string[]; truncated: boolean } {
    const entry = this.entries.get(serverId)
    if (entry === undefined) return { lines: [], truncated: false }
    const all = entry.logText
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line !== "")
    const lines = all.slice(-MCP_LOG_LINES)
    return {
      lines,
      truncated: entry.logsTruncated || lines.length < all.length,
    }
  }

  private appendLog(entry: Entry, chunk: string): void {
    entry.logText += chunk
    const buffer = Buffer.from(entry.logText, "utf8")
    if (buffer.length > MCP_MAX_STDERR_BYTES) {
      entry.logText = buffer
        .subarray(buffer.length - MCP_MAX_STDERR_BYTES)
        .toString("utf8")
      entry.logsTruncated = true
    }
  }

  private buildTransport(
    config: McpServerConfig,
    onStderr: (chunk: string) => void
  ): McpTransport {
    if (this.options.createTransport !== undefined) {
      return this.options.createTransport(config, onStderr)
    }
    if (config.transport === "stdio") {
      return new StdioTransport({
        command: config.command,
        args: config.args,
        cwd: config.cwd ?? undefined,
        env: keyValuesToRecord(config.env),
        // 继承宿主环境，否则 npx / node 这类命令找不到 PATH。
        inheritEnv: true,
        stderr: "pipe",
        onStderr,
        maxMessageBytes: MCP_MAX_MESSAGE_BYTES,
        closeTimeoutMs: MCP_CLOSE_TIMEOUT_MS,
      })
    }
    return new StreamableHttpTransport({
      url: config.url,
      headers: keyValuesToRecord(config.headers),
      maxMessageBytes: MCP_MAX_MESSAGE_BYTES,
    })
  }

  /** 彻底关掉一台服务器的连接，并清掉内存里的运行状态（能力快照保留）。 */
  private async closeEntry(serverId: string): Promise<void> {
    const entry = this.entries.get(serverId)
    if (entry === undefined) return
    const { client, transport } = entry
    // 先摘掉引用再关闭，onClose 才能区分「主动断开」与「被动掉线」。
    entry.client = null
    entry.transport = null
    entry.state = "disconnected"
    entry.connectedAt = null
    entry.serverInfo = null
    for (const dispose of entry.disposers) dispose()
    entry.disposers = []
    if (client !== null) await safeClose(client)
    else if (transport !== null) await safeClose(transport)
  }

  /**
   * 建立连接并读取能力清单。
   * 连不上不是异常而是业务结果：返回 failed 状态与可读原因，由页面持续展示。
   */
  async connect(config: McpServerConfig): Promise<{
    snapshot: McpRuntimeSnapshot
    capabilities: McpCapabilities | null
  }> {
    if (!config.enabled) {
      throw new McpRuntimeError(
        "disabled",
        `服务器「${config.name}」已停用，不能连接。`
      )
    }
    const existing = this.entries.get(config.id)
    if (existing?.state === "connecting") {
      throw new McpRuntimeError(
        "already_connecting",
        `服务器「${config.name}」正在连接中。`
      )
    }
    if (
      existing?.state === "connected" &&
      existing.client !== null &&
      existing.transport !== null
    ) {
      return {
        snapshot: this.snapshot(config.id),
        capabilities: existing.capabilities,
      }
    }

    await this.closeEntry(config.id)

    const entry = newEntry()
    entry.state = "connecting"
    this.entries.set(config.id, entry)

    let transport: McpTransport
    try {
      transport = this.buildTransport(config, (chunk) =>
        this.appendLog(entry, chunk)
      )
    } catch (error) {
      entry.state = "failed"
      entry.lastError = describeFailure(error)
      return { snapshot: this.snapshot(config.id), capabilities: null }
    }

    const client = new McpClient({
      name: MCP_CLIENT_NAME,
      version: MCP_CLIENT_VERSION,
      // 初始化请求用连接超时；后续请求各自带上更宽的调用超时。
      requestTimeoutMs: this.connectTimeoutMs,
      roots: [],
    })
    entry.client = client
    entry.transport = transport
    entry.disposers.push(
      client.onError((error) => {
        if (entry.client !== client) return
        entry.lastError = describeFailure(error)
      }),
      client.onClose(() => {
        // 主动断开时 closeEntry 已经把引用摘掉，这里只处理被动掉线。
        if (entry.client !== client) return
        entry.client = null
        entry.transport = null
        entry.state = "failed"
        entry.connectedAt = null
        entry.serverInfo = null
        entry.lastError = "连接已断开：服务端进程退出或网络中断。"
      })
    )

    const listOptional = async <T>(
      label: string,
      run: () => Promise<T>,
      fallback: T
    ): Promise<T> => {
      try {
        return await run()
      } catch (error) {
        // 服务端没声明这项能力时按「没有」处理；其它错误记日志但不让连接失败。
        if (error instanceof McpError && error.code === -32601) return fallback
        console.error(
          `[mac-manager] 读取 ${label} 失败：${describeFailure(error)}`
        )
        return fallback
      }
    }

    try {
      const loaded = await withTimeout(
        (async () => {
          // client.connect 自己会启动传输层，这里不能再调 transport.start()，
          // 否则 stdio 传输会因为「已经启动过」直接报错。
          const initialized = await client.connect(transport)
          const tools = await client.listTools({
            timeoutMs: this.requestTimeoutMs,
          })
          const resources = await listOptional(
            "资源清单",
            () => client.listResources({ timeoutMs: this.requestTimeoutMs }),
            []
          )
          const templates = await listOptional(
            "资源模板清单",
            () =>
              client.listResourceTemplates({
                timeoutMs: this.requestTimeoutMs,
              }),
            []
          )
          const prompts = await listOptional("提示词清单", async () => {
            const result = await client.request<{ prompts?: unknown }>(
              "prompts/list",
              {},
              { timeoutMs: this.requestTimeoutMs }
            )
            return result.prompts ?? []
          }, [])
          return { initialized, tools, resources, templates, prompts }
        })(),
        this.connectTimeoutMs,
        () => {
          void transport.close()
        }
      )

      entry.capabilities = normalizeCapabilities({
        tools: loaded.tools,
        resources: loaded.resources,
        resourceTemplates: loaded.templates,
        prompts: loaded.prompts,
        fetchedAt: Date.now(),
      })
      entry.serverInfo = {
        name: loaded.initialized.serverInfo.name,
        version: loaded.initialized.serverInfo.version,
        protocolVersion: loaded.initialized.protocolVersion,
      }
      entry.state = "connected"
      entry.connectedAt = Date.now()
      entry.lastError = null
    } catch (error) {
      for (const dispose of entry.disposers) dispose()
      entry.disposers = []
      entry.client = null
      entry.transport = null
      await safeClose(transport)
      entry.state = "failed"
      entry.connectedAt = null
      entry.serverInfo = null
      entry.lastError = describeFailure(error)
    }

    return {
      snapshot: this.snapshot(config.id),
      capabilities: entry.capabilities,
    }
  }

  async disconnect(serverId: string): Promise<McpRuntimeSnapshot> {
    await this.closeEntry(serverId)
    return this.snapshot(serverId)
  }

  /** 同一次调用还没返回时再次发起，直接拒绝，避免弱网下重复执行。 */
  private claim(key: string): () => void {
    if (this.inFlight.has(key)) {
      throw new McpRuntimeError(
        "duplicate_call",
        "同一次调用还在进行中，请等它返回后再试。"
      )
    }
    this.inFlight.add(key)
    return () => {
      this.inFlight.delete(key)
    }
  }

  private requireConnected(serverId: string): Entry {
    const entry = this.entries.get(serverId)
    if (
      entry === undefined ||
      entry.state !== "connected" ||
      entry.client === null
    ) {
      throw new McpRuntimeError(
        "not_connected",
        "服务器未连接，无法调用；请先连接后再试。"
      )
    }
    return entry
  }

  /**
   * 超时与取消都归为「结果未知」：等待结束了，但服务端可能已经执行完，
   * 所以既不报失败也不允许自动重试，要重新读取目标核实。
   */
  private outcomeOf(error: unknown, startedAt: number): McpCallOutcome {
    const timeout =
      error instanceof McpTimeoutError || error instanceof McpAbortError
    return {
      status: timeout ? "timeout-unknown" : "protocol-error",
      content: [],
      error: timeout
        ? `${describeFailure(error)}结果未知：服务端可能仍在执行，需要重新读取目标或查询任务状态核实，不能直接重试。`
        : describeFailure(error),
      durationMs: Date.now() - startedAt,
    }
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<McpCallOutcome> {
    const entry = this.requireConnected(serverId)
    const client = entry.client as McpClient
    const release = this.claim(
      `${serverId}:tool:${toolName}:${JSON.stringify(args).slice(0, 512)}`
    )
    const startedAt = Date.now()
    try {
      const result = await client.callTool(toolName, args, {
        timeoutMs: this.requestTimeoutMs,
      })
      const normalized = normalizeCallToolResult(result, MCP_MAX_RECORD_BYTES)
      return {
        status: normalized.isError ? "tool-error" : "ok",
        content: normalized.content,
        // MCP 用结果里的 isError 报告工具失败；这属于正常协议交换，不是连接错误。
        error: normalized.isError
          ? "工具报告失败（返回结果里 isError 为真）。"
          : null,
        durationMs: Date.now() - startedAt,
      }
    } catch (error) {
      return this.outcomeOf(error, startedAt)
    } finally {
      release()
    }
  }

  async readResource(serverId: string, uri: string): Promise<McpCallOutcome> {
    const entry = this.requireConnected(serverId)
    const client = entry.client as McpClient
    const release = this.claim(`${serverId}:resource:${uri}`)
    const startedAt = Date.now()
    try {
      const result = await client.readResource(uri, {
        timeoutMs: this.requestTimeoutMs,
      })
      return {
        status: "ok",
        content: normalizeReadResourceResult(result, MCP_MAX_RECORD_BYTES),
        error: null,
        durationMs: Date.now() - startedAt,
      }
    } catch (error) {
      return this.outcomeOf(error, startedAt)
    } finally {
      release()
    }
  }

  /**
   * 提示词在 pi-mcp 里没有专门方法，按协议直接请求 prompts/get。
   * 返回的消息按角色拼成文本，方便在页面上确认模板与参数是否对得上。
   */
  async getPrompt(
    serverId: string,
    name: string,
    args: Record<string, unknown>
  ): Promise<McpCallOutcome> {
    const entry = this.requireConnected(serverId)
    const client = entry.client as McpClient
    const release = this.claim(
      `${serverId}:prompt:${name}:${JSON.stringify(args).slice(0, 512)}`
    )
    const startedAt = Date.now()
    try {
      const result = await client.request<{
        description?: unknown
        messages?: unknown
      }>(
        "prompts/get",
        { name, arguments: args },
        { timeoutMs: this.requestTimeoutMs }
      )
      const lines: string[] = []
      if (typeof result.description === "string" && result.description !== "") {
        lines.push(result.description, "")
      }
      if (Array.isArray(result.messages)) {
        for (const message of result.messages) {
          const record =
            typeof message === "object" && message !== null
              ? (message as { role?: unknown; content?: unknown })
              : null
          const role =
            typeof record?.role === "string" ? record.role : "unknown"
          const content = record?.content
          const text =
            typeof content === "string"
              ? content
              : typeof content === "object" && content !== null
                ? (((content as { text?: unknown }).text as
                    | string
                    | undefined) ?? JSON.stringify(content))
                : String(content ?? "")
          lines.push(`[${role}]`, text, "")
        }
      }
      return {
        status: "ok",
        content: [
          {
            type: "text",
            text: lines.join("\n").trim() || "服务端返回了空的提示词。",
          },
        ],
        error: null,
        durationMs: Date.now() - startedAt,
      }
    } catch (error) {
      return this.outcomeOf(error, startedAt)
    } finally {
      release()
    }
  }

  /** 进程退出前的兜底回收；正常关闭路径是逐个 disconnect。 */
  async shutdown(): Promise<void> {
    for (const serverId of [...this.entries.keys()]) {
      await this.closeEntry(serverId)
    }
  }
}

let singleton: McpRuntime | null = null

/**
 * 应用内共用一个运行时。
 *
 * dev 下改了后端代码会重建整个 Express app，如果用「每次 createApp 新建一个
 * 运行时」，旧连接就没人关了；进程级单例避免这种泄漏。测试直接 new McpRuntime()
 * 注入，不碰这个单例。
 */
export const getMcpRuntime = (): McpRuntime => {
  singleton ??= new McpRuntime()
  return singleton
}
