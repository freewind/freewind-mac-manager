import type {
  McpCallRecord,
  McpCallStatus,
  McpCapabilities,
  McpContentBlock,
  McpServer,
  McpServerInfo,
  McpServerInput,
} from "../types"
import { SEED_CALLS, SEED_SERVERS } from "./seed"

/**
 * 演示用的内存「后端」。
 *
 * 它模拟一个 MCP 客户端：保存服务器配置、维护连接状态、缓存能力清单、
 * 执行工具调用并记录结果。全部状态只在本模块的内存里，刷新页面即重置。
 *
 * 刻意保留的「真实感」：
 * - 每个动作都有网络延迟，页面能真的看到加载与执行中状态；
 * - 连接会失败（github 的 token 无效），调用会超时（web_crawl）并返回结果未知；
 * - 未连接时工具清单可能来自上次缓存，因此必须标注可能已过期；
 * - 首次成功连接的服务器（memory）会「发现」出此前没有的能力清单。
 */

const clone = <T>(value: T): T => structuredClone(value)

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })

/** 300–900ms 的随机延迟，让每次调用耗时都不一样。 */
const latency = (minimum = 300, maximum = 900): number =>
  Math.round(minimum + Math.random() * (maximum - minimum))

let servers: McpServer[] = clone(SEED_SERVERS)
let calls: McpCallRecord[] = clone(SEED_CALLS)
let sequence = 0

const nextId = (prefix: string): string => {
  sequence += 1
  return `${prefix}-${Date.now().toString(36)}-${sequence}`
}

const findServer = (serverId: string): McpServer => {
  const found = servers.find((item) => item.config.id === serverId)
  if (!found) throw new Error(`找不到服务器「${serverId}」`)
  return found
}

/** 连接成功后才会出现的能力清单：用于演示「连上以后才发现工具」。 */
const DISCOVERED: Record<string, McpCapabilities> = {
  memory: {
    tools: [
      {
        name: "create_entities",
        title: "创建实体",
        description: "在知识图谱里创建实体；同名实体会被合并。",
        inputSchema: {
          type: "object",
          properties: {
            entities: {
              type: "array",
              description: "实体名数组",
              items: { type: "string" },
            },
          },
          required: ["entities"],
        },
        annotations: { readOnly: false, destructive: false, idempotent: true },
      },
      {
        name: "create_relations",
        title: "创建关系",
        description: "在两个实体之间建立有向关系。",
        inputSchema: {
          type: "object",
          properties: {
            from: { type: "string", description: "起点实体名" },
            to: { type: "string", description: "终点实体名" },
            relation: { type: "string", description: "关系类型" },
          },
          required: ["from", "to", "relation"],
        },
        annotations: { readOnly: false, destructive: false, idempotent: true },
      },
      {
        name: "search_nodes",
        title: "检索节点",
        description: "按关键词检索实体与关系，返回匹配的子图。",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "检索关键词" },
          },
          required: ["query"],
        },
        annotations: { readOnly: true, destructive: false, idempotent: true },
      },
      {
        name: "read_graph",
        title: "读取整图",
        description: "返回完整的知识图谱。",
        inputSchema: { type: "object", properties: {}, required: [] },
        annotations: { readOnly: true, destructive: false, idempotent: true },
      },
      {
        name: "delete_entities",
        title: "删除实体",
        description: "删除实体及其关联关系，不可撤销。",
        inputSchema: {
          type: "object",
          properties: {
            entities: {
              type: "array",
              description: "要删除的实体名数组",
              items: { type: "string" },
            },
          },
          required: ["entities"],
        },
        annotations: { readOnly: false, destructive: true, idempotent: false },
      },
    ],
    resources: [],
    resourceTemplates: [
      {
        uriTemplate: "memory://entity/{name}",
        name: "实体详情",
        description: "按实体名读取其关系网络",
        mimeType: "application/json",
        variables: ["name"],
      },
    ],
    prompts: [
      {
        name: "graph-summary",
        title: "图谱摘要",
        description: "让模型基于当前图谱写一段摘要。",
        arguments: [
          { name: "topic", description: "摘要围绕的主题", required: true },
        ],
      },
    ],
    fetchedAt: 0,
  },
}

const INFO_ON_CONNECT: Record<string, McpServerInfo> = {
  "tool-discovery": {
    name: "tool-discovery",
    version: "0.4.2",
    protocolVersion: "2025-06-18",
  },
  donsetch: {
    name: "donsetch",
    version: "2.3.0",
    protocolVersion: "2025-06-18",
  },
  filesystem: {
    name: "filesystem",
    version: "2025.7.1",
    protocolVersion: "2025-06-18",
  },
  paseo: { name: "paseo", version: "1.8.0", protocolVersion: "2025-06-18" },
  playwright: {
    name: "playwright",
    version: "0.0.41",
    protocolVersion: "2025-06-18",
  },
  memory: { name: "memory", version: "0.6.3", protocolVersion: "2025-06-18" },
}

/** 连接必然失败的服务器：用来演示失败原因要持续展示，而不是一闪而过的 toast。 */
const CONNECT_FAILURES: Record<string, string> = {
  github: "HTTP 401：Personal access token 无效或已过期",
}

/** 一张自绘的占位图，表示「这里本该是一张 PNG 截图」。 */
const SCREENSHOT_PLACEHOLDER = (): string => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420" viewBox="0 0 720 420">
  <rect width="720" height="420" fill="#f4f4f5"/>
  <rect x="24" y="24" width="672" height="372" rx="10" fill="#ffffff" stroke="#d4d4d8"/>
  <rect x="24" y="24" width="672" height="36" rx="10" fill="#e4e4e7"/>
  <circle cx="48" cy="42" r="5" fill="#f87171"/>
  <circle cx="66" cy="42" r="5" fill="#fbbf24"/>
  <circle cx="84" cy="42" r="5" fill="#34d399"/>
  <rect x="110" y="34" width="260" height="16" rx="8" fill="#f4f4f5"/>
  <rect x="56" y="96" width="300" height="22" rx="6" fill="#d4d4d8"/>
  <rect x="56" y="134" width="560" height="12" rx="6" fill="#e4e4e7"/>
  <rect x="56" y="156" width="520" height="12" rx="6" fill="#e4e4e7"/>
  <rect x="56" y="178" width="480" height="12" rx="6" fill="#e4e4e7"/>
  <rect x="56" y="220" width="180" height="120" rx="8" fill="#f4f4f5" stroke="#e4e4e7"/>
  <rect x="256" y="220" width="180" height="120" rx="8" fill="#f4f4f5" stroke="#e4e4e7"/>
  <rect x="456" y="220" width="160" height="120" rx="8" fill="#f4f4f5" stroke="#e4e4e7"/>
  <text x="360" y="384" font-family="system-ui, sans-serif" font-size="13" fill="#71717a" text-anchor="middle">演示占位图 · 未包含真实截图</text>
</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/** 预置的工具返回内容；没有预置的走通用兜底。 */
const TOOL_RESULTS: Record<string, McpContentBlock[]> = {
  "tool-discovery:list_tags": [
    {
      type: "json",
      value: {
        tags: [
          { tag: "call-hierarchy", toolCount: 6 },
          { tag: "diagnostics", toolCount: 9 },
          { tag: "impact-analysis", toolCount: 5 },
          { tag: "refactoring", toolCount: 12 },
          { tag: "symbol-lookup", toolCount: 18 },
        ],
      },
    },
  ],
  "tool-discovery:browse_tag": [
    {
      type: "text",
      text: "refactoring 下有 12 个工具：ts_preview_symbol_rename、ts_organize_imports、ts_move_paths、ts_split_exports、ts_code_actions、serena_rename_symbol……",
    },
  ],
  "tool-discovery:search": [
    {
      type: "text",
      text: "找到 4 个工具：\n- ts_preview_symbol_rename — 预览符号重命名的影响面\n- serena_rename_symbol — LSP 级符号重命名\n- ts_organize_imports — 整理 import 顺序\n- codegraph_analyze_impact — 影响分析",
    },
  ],
  "tool-discovery:get": [
    {
      type: "json",
      value: {
        tools: [
          {
            name: "codegraph_find_callers",
            summary: "找出所有调用某符号的位置",
            parameters: { project: "string", symbol: "string" },
          },
        ],
      },
    },
  ],
  "tool-discovery:execute": [
    {
      type: "json",
      value: {
        exitCode: 0,
        output: "12 callers found in 4 files (0.42s)",
      },
    },
  ],
  "donsetch:web_search": [
    {
      type: "json",
      value: {
        results: [
          {
            title: "Model Context Protocol — Transports",
            url: "https://modelcontextprotocol.io/specification/transports",
            snippet:
              "MCP 定义两种标准传输：stdio 用于本机子进程，Streamable HTTP 用于远程服务。",
          },
          {
            title: "MCP TypeScript SDK",
            url: "https://github.com/modelcontextprotocol/typescript-sdk",
            snippet: "官方 TypeScript SDK，包含 Client 与 Server 实现。",
          },
        ],
      },
    },
  ],
  "donsetch:web_fetch": [
    {
      type: "resource",
      uri: "https://modelcontextprotocol.io/specification/transports",
      mimeType: "text/markdown",
      text: "## Transports\n\nMCP 使用 JSON-RPC 2.0 编码消息。本机场景用 stdio，远程场景用 Streamable HTTP……",
    },
  ],
  "donsetch:web_screenshot": [
    {
      type: "image",
      mimeType: "image/png",
      bytes: 284_137,
      previewDataUrl: SCREENSHOT_PLACEHOLDER(),
    },
  ],
  "filesystem:read_file": [
    {
      type: "resource",
      uri: "file:///Users/peng.li/workspace/freewind-mac-manager/package.json",
      mimeType: "application/json",
      text: '{\n  "name": "freewind-mac-manager",\n  "version": "0.0.1",\n  "type": "module"\n}',
    },
  ],
  "filesystem:list_directory": [
    {
      type: "json",
      value: [
        { name: "src", type: "directory", size: 0 },
        { name: "package.json", type: "file", size: 2891 },
        { name: "AGENTS.md", type: "file", size: 21284 },
      ],
    },
  ],
  "filesystem:search_files": [
    {
      type: "json",
      value: {
        matches: [
          "src/web/features/mcp-servers/McpServersPage.tsx",
          "src/web/features/mcp-servers/queries.ts",
          "src/web/features/mcp-servers/types.ts",
        ],
      },
    },
  ],
  "filesystem:move_file": [
    {
      type: "text",
      text: "已移动：/tmp/demo/a.ts → /tmp/demo/archive/a.ts",
    },
  ],
  "playwright:browser_navigate": [
    { type: "text", text: "已打开 https://example.com ，等待 load 事件完成。" },
  ],
  "playwright:browser_snapshot": [
    {
      type: "text",
      text: '- heading "Example Domain" [ref=e1]\n- paragraph "This domain is for use in examples." [ref=e2]\n- link "More information..." [ref=e3]',
    },
  ],
  "playwright:browser_click": [
    { type: "text", text: '已点击 link "More information..."，页面已跳转。' },
  ],
  "playwright:browser_type": [
    { type: "text", text: "已在搜索框输入「mcp」，未提交。" },
  ],
  "paseo:list_agents": [
    {
      type: "json",
      value: {
        agents: [
          {
            id: "agt_8f21",
            provider: "claude",
            status: "idle",
            workspace: "freewind-mac-manager",
          },
          {
            id: "agt_1c07",
            provider: "codex",
            status: "running",
            workspace: "paseo",
          },
        ],
      },
    },
  ],
  "paseo:get_agent_status": [
    {
      type: "json",
      value: {
        id: "agt_8f21",
        status: "idle",
        lastActivityAt: "刚刚",
        workspace: "freewind-mac-manager",
      },
    },
  ],
  "paseo:create_agent": [
    {
      type: "json",
      value: {
        agentId: "agt_93bd",
        status: "starting",
        workspace: "/Users/peng.li/workspace/freewind-mac-manager",
      },
    },
  ],
  "paseo:send_agent_prompt": [
    { type: "text", text: "指令已投递，agent 正在处理。" },
  ],
  "memory:create_entities": [
    { type: "json", value: { created: 2, merged: 0 } },
  ],
  "memory:create_relations": [
    { type: "json", value: { created: 1, merged: 0 } },
  ],
  "memory:search_nodes": [
    {
      type: "json",
      value: {
        entities: [{ name: "freewind-mac-manager", entityType: "project" }],
        relations: [
          {
            from: "freewind-mac-manager",
            to: "freewind-mac-manager",
            relation: "uses",
          },
        ],
      },
    },
  ],
  "memory:read_graph": [
    {
      type: "json",
      value: {
        entities: [
          { name: "freewind-mac-manager", entityType: "project" },
          { name: "Biome", entityType: "tool" },
        ],
        relations: [
          { from: "freewind-mac-manager", to: "Biome", relation: "uses" },
        ],
      },
    },
  ],
  "memory:delete_entities": [{ type: "json", value: { deleted: 1 } }],
}

const genericResult = (
  serverName: string,
  toolName: string
): McpContentBlock[] => [
  {
    type: "text",
    text: `${serverName} 的 ${toolName} 已返回。这是演示环境生成的占位结果：真实调用会返回服务端自己的内容。`,
  },
]

const appendCall = (record: McpCallRecord): McpCallRecord => {
  calls = [record, ...calls].slice(0, 200)
  return clone(record)
}

const buildRecord = (input: {
  server: McpServer
  kind: McpCallRecord["kind"]
  name: string
  status: McpCallStatus
  startedAt: number
  durationMs: number
  request: unknown
  content: McpContentBlock[]
  error: string | null
}): McpCallRecord => ({
  id: nextId("call"),
  serverId: input.server.config.id,
  serverName: input.server.config.name,
  kind: input.kind,
  name: input.name,
  status: input.status,
  startedAt: input.startedAt,
  durationMs: input.durationMs,
  request: clone(input.request),
  content: clone(input.content),
  error: input.error,
})

export const listServers = async (): Promise<McpServer[]> => {
  await delay(latency(120, 320))
  return clone(servers)
}

export const listCalls = async (
  serverId: string | null
): Promise<McpCallRecord[]> => {
  await delay(latency(80, 220))
  const visible =
    serverId === null
      ? calls
      : calls.filter((item) => item.serverId === serverId)
  return clone(visible)
}

export const createServer = async (
  input: McpServerInput
): Promise<McpServer> => {
  await delay(latency(300, 700))
  if (servers.some((item) => item.config.name === input.name)) {
    throw new Error(`已经有一个叫「${input.name}」的服务器`)
  }
  const created: McpServer = {
    config: {
      ...clone(input),
      id: nextId("srv"),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    status: { state: "disconnected", connectedAt: null, lastError: null },
    serverInfo: null,
    capabilities: null,
  }
  servers = [...servers, created]
  return clone(created)
}

export const updateServer = async (
  serverId: string,
  input: McpServerInput
): Promise<McpServer> => {
  await delay(latency(300, 700))
  const target = findServer(serverId)
  if (
    servers.some(
      (item) => item.config.id !== serverId && item.config.name === input.name
    )
  ) {
    throw new Error(`已经有一个叫「${input.name}」的服务器`)
  }
  // 改了传输方式或地址就等于换了目标：旧连接与旧能力清单都不能再用。
  const changedTarget =
    target.config.transport !== input.transport ||
    target.config.command !== input.command ||
    target.config.url !== input.url ||
    JSON.stringify(target.config.args) !== JSON.stringify(input.args)
  target.config = {
    ...clone(input),
    id: serverId,
    createdAt: target.config.createdAt,
    updatedAt: Date.now(),
  }
  if (changedTarget) {
    target.status = {
      state: "disconnected",
      connectedAt: null,
      lastError: null,
    }
    target.serverInfo = null
    target.capabilities = null
  }
  return clone(target)
}

export const deleteServer = async (serverId: string): Promise<void> => {
  await delay(latency(200, 500))
  findServer(serverId)
  servers = servers.filter((item) => item.config.id !== serverId)
  calls = calls.filter((item) => item.serverId !== serverId)
}

export const connectServer = async (serverId: string): Promise<McpServer> => {
  const target = findServer(serverId)
  target.status = { ...target.status, state: "connecting", lastError: null }
  await delay(latency(700, 1400))

  const failure = CONNECT_FAILURES[serverId]
  if (failure) {
    target.status = { state: "failed", connectedAt: null, lastError: failure }
    return clone(target)
  }

  target.status = {
    state: "connected",
    connectedAt: Date.now(),
    lastError: null,
  }
  target.serverInfo = INFO_ON_CONNECT[serverId] ?? {
    name: target.config.name,
    version: "1.0.0",
    protocolVersion: "2025-06-18",
  }
  const discovered = DISCOVERED[serverId]
  if (discovered && target.capabilities === null) {
    target.capabilities = { ...clone(discovered), fetchedAt: Date.now() }
  } else if (target.capabilities !== null) {
    // 重连即重新拉取能力清单：过期时间被刷新。
    target.capabilities = { ...target.capabilities, fetchedAt: Date.now() }
  }
  return clone(target)
}

export const disconnectServer = async (
  serverId: string
): Promise<McpServer> => {
  await delay(latency(150, 400))
  const target = findServer(serverId)
  // 断开不清空能力清单：保留下来供离线查看，但要标注可能已过期。
  target.status = { state: "disconnected", connectedAt: null, lastError: null }
  target.serverInfo = null
  return clone(target)
}

const requireConnected = (server: McpServer): void => {
  if (server.status.state !== "connected") {
    throw new Error(
      `服务器「${server.config.name}」未连接，无法调用。请先连接后再试。`
    )
  }
}

export const callTool = async (
  serverId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<McpCallRecord> => {
  const server = findServer(serverId)
  requireConnected(server)
  const tool = server.capabilities?.tools.find((item) => item.name === toolName)
  if (!tool) throw new Error(`服务器里没有名为「${toolName}」的工具`)

  const key = `${serverId}:${toolName}`
  const startedAt = Date.now()

  // 超时演示：等待 5 秒后返回「结果未知」，不返回失败。
  if (key === "donsetch:web_crawl") {
    await delay(5000)
    return appendCall(
      buildRecord({
        server,
        kind: "tool",
        name: toolName,
        status: "timeout-unknown",
        startedAt,
        durationMs: Date.now() - startedAt,
        request: args,
        content: [],
        error:
          "等待 5 秒仍未返回。结果未知：服务端可能仍在抓取，需要重新读取目标或查询任务状态，不能直接重试。",
      })
    )
  }

  // 工具自己报告失败：内容照常返回，但 isError 为真。
  if (key === "filesystem:write_file") {
    await delay(latency(120, 320))
    const path = String(args.path ?? "")
    return appendCall(
      buildRecord({
        server,
        kind: "tool",
        name: toolName,
        status: "tool-error",
        startedAt,
        durationMs: Date.now() - startedAt,
        request: args,
        content: [
          {
            type: "text",
            text: `EACCES: permission denied, open '${path || "/unknown"}'`,
          },
        ],
        error: "工具报告失败：目标文件不可写。",
      })
    )
  }

  await delay(latency(300, 900))
  return appendCall(
    buildRecord({
      server,
      kind: "tool",
      name: toolName,
      status: "ok",
      startedAt,
      durationMs: Date.now() - startedAt,
      request: args,
      content: TOOL_RESULTS[key] ?? genericResult(server.config.name, toolName),
      error: null,
    })
  )
}

export const readResource = async (
  serverId: string,
  uri: string
): Promise<McpCallRecord> => {
  const server = findServer(serverId)
  requireConnected(server)
  const startedAt = Date.now()
  await delay(latency(200, 600))
  const declared =
    server.capabilities?.resources.find((item) => item.uri === uri) ??
    server.capabilities?.resourceTemplates.find((item) =>
      uri.startsWith(item.uriTemplate.split("{")[0])
    )
  if (!declared) throw new Error(`服务器没有声明资源「${uri}」`)
  return appendCall(
    buildRecord({
      server,
      kind: "resource",
      name: declared.name,
      status: "ok",
      startedAt,
      durationMs: Date.now() - startedAt,
      request: { uri },
      content: [
        {
          type: "resource",
          uri,
          mimeType: declared.mimeType,
          text: `这是资源 ${uri} 的演示内容（${declared.mimeType}）。真实读取会返回服务端提供的文本或二进制数据。`,
        },
      ],
      error: null,
    })
  )
}

export const getPrompt = async (
  serverId: string,
  name: string,
  args: Record<string, unknown>
): Promise<McpCallRecord> => {
  const server = findServer(serverId)
  requireConnected(server)
  const declared = server.capabilities?.prompts.find(
    (item) => item.name === name
  )
  if (!declared) throw new Error(`服务器没有声明提示词「${name}」`)
  const startedAt = Date.now()
  await delay(latency(200, 500))
  const filled = declared.arguments
    .map((item) => `${item.name}: ${String(args[item.name] ?? "（未填）")}`)
    .join("\n")
  return appendCall(
    buildRecord({
      server,
      kind: "prompt",
      name: declared.name,
      status: "ok",
      startedAt,
      durationMs: Date.now() - startedAt,
      request: args,
      content: [
        {
          type: "text",
          text: `提示词「${declared.title}」已按参数渲染：\n\n${filled}\n\n——\n${declared.description}`,
        },
      ],
      error: null,
    })
  )
}
