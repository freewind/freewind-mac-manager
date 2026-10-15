import type {
  McpCallRecord,
  McpCapabilities,
  McpJsonSchema,
  McpJsonSchemaProperty,
  McpPrompt,
  McpResource,
  McpResourceTemplate,
  McpServer,
  McpTool,
  McpToolAnnotations,
} from "../types"

/**
 * 演示用的种子数据。
 *
 * 这些内容模拟一台已经配好若干 MCP Server 的机器：有连上的、有断开的、
 * 有连接失败的，能力和调用记录都尽量贴近真实 MCP 的形状，方便在接后端前
 * 先把界面看清楚。所有数据只存在于浏览器内存，刷新即重置。
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const NOW = Date.now()

/** 工具入参 schema 的简写：只写属性与必填项。 */
const schema = (
  properties: Record<string, McpJsonSchemaProperty>,
  required: string[] = []
): McpJsonSchema => ({ type: "object", properties, required })

const prop = (
  type: McpJsonSchemaProperty["type"],
  description: string,
  extra: Partial<McpJsonSchemaProperty> = {}
): McpJsonSchemaProperty => ({ type, description, ...extra })

const str = (description: string, extra?: Partial<McpJsonSchemaProperty>) =>
  prop("string", description, extra)

const int = (description: string, extra?: Partial<McpJsonSchemaProperty>) =>
  prop("integer", description, extra)

const bool = (description: string, extra?: Partial<McpJsonSchemaProperty>) =>
  prop("boolean", description, extra)

const lines = (description: string) =>
  prop("array", description, { items: { type: "string" } })

const raw = (description: string) => prop("object", description)

const READ_ONLY: McpToolAnnotations = {
  readOnly: true,
  destructive: false,
  idempotent: true,
}

const WRITE: McpToolAnnotations = {
  readOnly: false,
  destructive: false,
  idempotent: true,
}

const DESTRUCTIVE: McpToolAnnotations = {
  readOnly: false,
  destructive: true,
  idempotent: false,
}

const tool = (
  name: string,
  title: string,
  description: string,
  inputSchema: McpJsonSchema,
  annotations: McpToolAnnotations
): McpTool => ({ name, title, description, inputSchema, annotations })

const prompt = (
  name: string,
  title: string,
  description: string,
  args: McpPrompt["arguments"]
): McpPrompt => ({ name, title, description, arguments: args })

const resource = (
  uri: string,
  name: string,
  description: string,
  mimeType: string
): McpResource => ({ uri, name, description, mimeType })

const template = (
  uriTemplate: string,
  name: string,
  description: string,
  mimeType: string,
  variables: string[]
): McpResourceTemplate => ({
  uriTemplate,
  name,
  description,
  mimeType,
  variables,
})

const capabilities = (
  fetchedAt: number,
  tools: McpTool[],
  resources: McpResource[] = [],
  resourceTemplates: McpResourceTemplate[] = [],
  prompts: McpPrompt[] = []
): McpCapabilities => ({
  tools,
  resources,
  resourceTemplates,
  prompts,
  fetchedAt,
})

/** tool-discovery：本机工具目录，5 个工具，和真实服务同名同参。 */
const toolDiscoveryTools: McpTool[] = [
  tool(
    "list_tags",
    "列出全部标签",
    "返回工具目录里所有启用标签及每个标签的工具数，用于先获得全局视野。",
    schema({}),
    READ_ONLY
  ),
  tool(
    "browse_tag",
    "按标签浏览",
    "列出指定标签下的全部工具名称、摘要与标签，不受搜索条数限制。",
    schema(
      {
        tag: str("标签 ID，必须来自 list_tags 的结果", {
          enum: [
            "call-hierarchy",
            "diagnostics",
            "impact-analysis",
            "refactoring",
            "symbol-lookup",
          ],
        }),
      },
      ["tag"]
    ),
    READ_ONLY
  ),
  tool(
    "search",
    "关键词搜索",
    "按 BM25 关键词搜索工具目录，返回轻量的名称与摘要列表。",
    schema(
      {
        query: str("英文功能关键词，例如 rename symbol"),
        limit: int("最大返回条数", { default: 8, minimum: 1, maximum: 20 }),
      },
      ["query"]
    ),
    READ_ONLY
  ),
  tool(
    "get",
    "获取工具定义",
    "按名称批量获取工具的完整定义：参数 schema、示例、标签与超时时间。",
    schema(
      {
        tools: lines('工具名数组，例如 ["codegraph_find_callers"]'),
      },
      ["tools"]
    ),
    READ_ONLY
  ),
  tool(
    "execute",
    "执行工具",
    "按工具名执行工具并返回退出码与输出。会真的改动本机状态，执行前必须确认。",
    schema(
      {
        tool: str("要执行的工具名"),
        params: raw("工具参数对象，结构与 get 返回的定义一致"),
      },
      ["tool"]
    ),
    DESTRUCTIVE
  ),
]

/** donsetch：联网读取，含一个会返回图片的工具和一个超时工具。 */
const donsetchTools: McpTool[] = [
  tool(
    "web_search",
    "网页搜索",
    "按关键词发现候选来源，返回标题与摘要，不返回正文。",
    schema(
      {
        query: str("检索词，包含必要实体与排除项"),
        intent: str("检索意图，影响使用的后端", {
          enum: ["auto", "web", "code", "paper", "news", "entity"],
          default: "auto",
        }),
        max_results: int("最大返回条数", {
          default: 7,
          minimum: 1,
          maximum: 12,
        }),
      },
      ["query"]
    ),
    READ_ONLY
  ),
  tool(
    "web_fetch",
    "读取网页",
    "读取一个 URL 或一批 URL 的正文 Markdown；可用 focus 只取相关段落。",
    schema(
      {
        url: str("要读取的 URL，也接受多个 URL 组成的数组"),
        focus: str("只返回与该问题相关的段落；不需要整页时填"),
        mode: str("正文预算档位", {
          enum: ["scan", "read", "deep"],
          default: "read",
        }),
        max_chars: int("返回正文的最大字符数", {
          default: 16000,
          minimum: 200,
          maximum: 500000,
        }),
      },
      ["url"]
    ),
    READ_ONLY
  ),
  tool(
    "web_crawl",
    "站点爬取",
    "从一个种子页出发按链接抓取多页，受页数与深度预算约束。",
    schema(
      {
        url: str("种子页 URL"),
        focus: str("抓取主题，用于挑选相关页面"),
        max_pages: int("最多抓取页数", {
          default: 10,
          minimum: 1,
          maximum: 200,
        }),
        max_depth: int("最大链接深度", { default: 2, minimum: 0, maximum: 5 }),
      },
      ["url"]
    ),
    READ_ONLY
  ),
  tool(
    "web_screenshot",
    "网页截图",
    "把 URL 渲染成 PNG，返回图片内容块与文件路径。",
    schema(
      {
        url: str("要截图的 URL"),
        full_page: bool("截取整页高度，而不只是视口", { default: false }),
        wait_ms: int("加载完成后的额外等待毫秒数", {
          default: 600,
          maximum: 5000,
        }),
      },
      ["url"]
    ),
    READ_ONLY
  ),
]

/** filesystem：读写本机文件，含两个破坏性工具。 */
const filesystemTools: McpTool[] = [
  tool(
    "read_file",
    "读取文件",
    "读取允许范围内某个文件的文本内容。",
    schema({ path: str("文件绝对路径") }, ["path"]),
    READ_ONLY
  ),
  tool(
    "list_directory",
    "列出目录",
    "列出目录下的条目，带类型与大小。",
    schema({ path: str("目录绝对路径") }, ["path"]),
    READ_ONLY
  ),
  tool(
    "search_files",
    "按名搜索文件",
    "在目录内按 glob 模式搜索文件名，不搜索文件内容。",
    schema(
      {
        path: str("起始目录绝对路径"),
        pattern: str("glob 模式，例如 **/*.ts"),
        max_results: int("最多返回条数", { default: 100, minimum: 1 }),
      },
      ["path", "pattern"]
    ),
    READ_ONLY
  ),
  tool(
    "write_file",
    "写入文件",
    "把内容写入文件，文件已存在时会被整体覆盖。",
    schema(
      {
        path: str("文件绝对路径"),
        content: str("要写入的完整内容"),
      },
      ["path", "content"]
    ),
    DESTRUCTIVE
  ),
  tool(
    "move_file",
    "移动或重命名",
    "把文件从源路径移动到目标路径；目标已存在时会失败。",
    schema(
      {
        source: str("源绝对路径"),
        destination: str("目标绝对路径"),
      },
      ["source", "destination"]
    ),
    DESTRUCTIVE
  ),
]

/** playwright：浏览器控制，当前未连接，只保留上次连接缓存的能力。 */
const playwrightTools: McpTool[] = [
  tool(
    "browser_navigate",
    "打开页面",
    "在浏览器里打开指定 URL 并等待加载完成。",
    schema({ url: str("要打开的 URL") }, ["url"]),
    READ_ONLY
  ),
  tool(
    "browser_snapshot",
    "页面快照",
    "返回当前页面的可达性树快照，用于定位可交互元素。",
    schema({}),
    READ_ONLY
  ),
  tool(
    "browser_click",
    "点击元素",
    "按快照里的引用点击元素，可能触发提交或跳转。",
    schema(
      {
        element: str("元素的人类可读描述"),
        ref: str("快照里的元素引用"),
      },
      ["element", "ref"]
    ),
    DESTRUCTIVE
  ),
  tool(
    "browser_type",
    "输入文本",
    "向输入框写入文本，可选回车提交。",
    schema(
      {
        element: str("输入框的人类可读描述"),
        ref: str("快照里的元素引用"),
        text: str("要输入的内容"),
        submit: bool("输入后按回车提交", { default: false }),
      },
      ["element", "ref", "text"]
    ),
    WRITE
  ),
]

/** paseo：本机 agent 编排，含一个会真的起 agent 的破坏性工具。 */
const paseoTools: McpTool[] = [
  tool(
    "list_agents",
    "列出 Agent",
    "列出本机当前所有 agent 及其状态。",
    schema({}),
    READ_ONLY
  ),
  tool(
    "get_agent_status",
    "查看 Agent 状态",
    "读取单个 agent 的当前状态与最近活动时间。",
    schema({ agentId: str("agent 标识") }, ["agentId"]),
    READ_ONLY
  ),
  tool(
    "create_agent",
    "创建 Agent",
    "在指定 workspace 里起一个新 agent，会占用本机资源并产生真实改动。",
    schema(
      {
        workspace: str("workspace 绝对路径"),
        provider: str("provider 名称", {
          enum: ["claude", "codex", "gemini", "opencode"],
        }),
        model: str("模型 ID"),
        prompt: str("交给 agent 的首条指令"),
      },
      ["workspace", "provider", "prompt"]
    ),
    DESTRUCTIVE
  ),
  tool(
    "send_agent_prompt",
    "给 Agent 发消息",
    "把新指令发给运行中的 agent。",
    schema(
      {
        agentId: str("agent 标识"),
        prompt: str("要发送的指令"),
      },
      ["agentId", "prompt"]
    ),
    WRITE
  ),
]

export const SEED_SERVERS: McpServer[] = [
  {
    config: {
      id: "tool-discovery",
      name: "tool-discovery",
      description:
        "本机工具目录：按标签浏览、按关键词搜索，再取详情并执行 129 个专业工具。",
      transport: "stdio",
      command: "node",
      args: [
        "/Users/peng.li/workspace/freewind-tool-discovery-mcp-server/dist/index.js",
      ],
      cwd: "/Users/peng.li/workspace/freewind-tool-discovery-mcp-server",
      env: [],
      url: "",
      headers: [],
      enabled: true,
      tags: ["本机", "工具目录"],
      createdAt: NOW - 12 * DAY,
      updatedAt: NOW - 2 * DAY,
    },
    status: {
      state: "connected",
      connectedAt: NOW - 42 * MINUTE,
      lastError: null,
    },
    serverInfo: {
      name: "tool-discovery",
      version: "0.4.2",
      protocolVersion: "2025-06-18",
    },
    capabilities: capabilities(
      NOW - 42 * MINUTE,
      toolDiscoveryTools,
      [
        resource(
          "tool-catalog://index",
          "工具索引",
          "全部工具的索引文档",
          "application/json"
        ),
      ],
      [],
      [
        prompt(
          "tool-usage-guide",
          "工具使用指南",
          "把「用哪个工具、怎么传参」的说明拼成一段提示词。",
          [
            {
              name: "task",
              description: "要完成的任务描述",
              required: true,
            },
          ]
        ),
      ]
    ),
  },
  {
    config: {
      id: "donsetch",
      name: "donsetch",
      description: "联网读取：搜索、抓正文、爬站点、整页截图。",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@donsetch/mcp-server"],
      cwd: null,
      env: [{ key: "DONSETCH_TIMEOUT_MS", value: "30000" }],
      url: "",
      headers: [],
      enabled: true,
      tags: ["联网", "检索"],
      createdAt: NOW - 9 * DAY,
      updatedAt: NOW - 9 * DAY,
    },
    status: {
      state: "connected",
      connectedAt: NOW - 40 * MINUTE,
      lastError: null,
    },
    serverInfo: {
      name: "donsetch",
      version: "2.3.0",
      protocolVersion: "2025-06-18",
    },
    capabilities: capabilities(NOW - 40 * MINUTE, donsetchTools),
  },
  {
    config: {
      id: "filesystem",
      name: "filesystem",
      description: "受控目录的文件读写：只允许访问 workspace 下的路径。",
      transport: "stdio",
      command: "npx",
      args: [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/peng.li/workspace",
      ],
      cwd: null,
      env: [],
      url: "",
      headers: [],
      enabled: true,
      tags: ["文件", "本机"],
      createdAt: NOW - 30 * DAY,
      updatedAt: NOW - 30 * DAY,
    },
    status: {
      state: "connected",
      connectedAt: NOW - 41 * MINUTE,
      lastError: null,
    },
    serverInfo: {
      name: "filesystem",
      version: "2025.7.1",
      protocolVersion: "2025-06-18",
    },
    capabilities: capabilities(
      NOW - 41 * MINUTE,
      filesystemTools,
      [],
      [
        template(
          "file:///Users/peng.li/workspace/{path}",
          "工作区文件",
          "按相对路径读取 workspace 下的文件",
          "text/plain",
          ["path"]
        ),
      ]
    ),
  },
  {
    config: {
      id: "paseo",
      name: "paseo",
      description: "本机 agent 编排：查看、创建和指挥 Paseo agent。",
      transport: "http",
      command: "",
      args: [],
      cwd: null,
      env: [],
      url: "http://127.0.0.1:18789/mcp",
      headers: [],
      enabled: true,
      tags: ["agent", "本机"],
      createdAt: NOW - 3 * DAY,
      updatedAt: NOW - 3 * DAY,
    },
    status: {
      state: "connected",
      connectedAt: NOW - 39 * MINUTE,
      lastError: null,
    },
    serverInfo: {
      name: "paseo",
      version: "1.8.0",
      protocolVersion: "2025-06-18",
    },
    capabilities: capabilities(NOW - 39 * MINUTE, paseoTools, [
      resource(
        "paseo://workspaces",
        "Workspace 列表",
        "本机已注册的 workspace",
        "application/json"
      ),
    ]),
  },
  {
    config: {
      id: "playwright",
      name: "playwright",
      description: "浏览器自动化：打开页面、快照、点击与输入。",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@playwright/mcp@latest"],
      cwd: null,
      env: [{ key: "PLAYWRIGHT_HEADLESS", value: "1" }],
      url: "",
      headers: [],
      enabled: false,
      tags: ["浏览器"],
      createdAt: NOW - 20 * DAY,
      updatedAt: NOW - 6 * DAY,
    },
    status: {
      state: "disconnected",
      connectedAt: null,
      lastError: null,
    },
    serverInfo: null,
    capabilities: capabilities(NOW - 6 * DAY, playwrightTools),
  },
  {
    config: {
      id: "github",
      name: "github",
      description: "GitHub 远程 MCP：仓库、Issue 与 Pull Request 操作。",
      transport: "http",
      command: "",
      args: [],
      cwd: null,
      env: [],
      url: "https://api.githubcopilot.com/mcp/",
      headers: [{ key: "Authorization", value: "Bearer ghp_••••••••" }],
      enabled: true,
      tags: ["远程", "代码托管"],
      createdAt: NOW - 2 * DAY,
      updatedAt: NOW - 2 * DAY,
    },
    status: {
      state: "failed",
      connectedAt: null,
      lastError: "HTTP 401：Personal access token 无效或已过期",
    },
    serverInfo: null,
    capabilities: null,
  },
  {
    config: {
      id: "memory",
      name: "memory",
      description: "知识图谱式记忆：把事实存成实体与关系，供后续检索。",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
      cwd: null,
      env: [],
      url: "",
      headers: [],
      enabled: false,
      tags: ["记忆"],
      createdAt: NOW - 45 * DAY,
      updatedAt: NOW - 45 * DAY,
    },
    status: {
      state: "disconnected",
      connectedAt: null,
      lastError: null,
    },
    serverInfo: null,
    capabilities: null,
  },
]

/** 初始调用记录：覆盖正常、工具报错、协议错误和超时未知四种结果。 */
export const SEED_CALLS: McpCallRecord[] = [
  {
    id: "call-seed-1",
    serverId: "tool-discovery",
    serverName: "tool-discovery",
    kind: "tool",
    name: "search",
    status: "ok",
    startedAt: NOW - 38 * MINUTE,
    durationMs: 318,
    request: { query: "rename symbol", limit: 8 },
    content: [
      {
        type: "text",
        text: "找到 4 个工具：\n- ts_preview_symbol_rename — 预览符号重命名影响面\n- serena_rename_symbol — LSP 级符号重命名\n- ts_organize_imports — 整理 import\n- codegraph_analyze_impact — 影响分析",
      },
    ],
    error: null,
  },
  {
    id: "call-seed-2",
    serverId: "filesystem",
    serverName: "filesystem",
    kind: "tool",
    name: "read_file",
    status: "ok",
    startedAt: NOW - 31 * MINUTE,
    durationMs: 46,
    request: {
      path: "/Users/peng.li/workspace/freewind-mac-manager/package.json",
    },
    content: [
      {
        type: "resource",
        uri: "file:///Users/peng.li/workspace/freewind-mac-manager/package.json",
        mimeType: "application/json",
        text: '{ "name": "freewind-mac-manager", "version": "0.0.1" }',
      },
    ],
    error: null,
  },
  {
    id: "call-seed-3",
    serverId: "donsetch",
    serverName: "donsetch",
    kind: "tool",
    name: "web_crawl",
    status: "timeout-unknown",
    startedAt: NOW - 26 * MINUTE,
    durationMs: 30000,
    request: { url: "https://example.com/docs", max_pages: 40, max_depth: 3 },
    content: [],
    error:
      "等待 30 秒仍未返回。结果未知：服务端可能仍在抓取，需要重新读取目标或查询任务状态，不能直接重试。",
  },
  {
    id: "call-seed-4",
    serverId: "tool-discovery",
    serverName: "tool-discovery",
    kind: "tool",
    name: "execute",
    status: "protocol-error",
    startedAt: NOW - 19 * MINUTE,
    durationMs: 12,
    request: {
      tool: "codegraph_find_callers",
      params: { project: "/tmp/demo", symbol: "parseConfig" },
    },
    content: [],
    error:
      "JSON-RPC error -32602：未知参数 project；该工具要求绝对路径的 project 字段。",
  },
  {
    id: "call-seed-5",
    serverId: "filesystem",
    serverName: "filesystem",
    kind: "tool",
    name: "write_file",
    status: "tool-error",
    startedAt: NOW - 12 * MINUTE,
    durationMs: 8,
    request: {
      path: "/Users/peng.li/workspace/freewind-mac-manager/README.md",
      content: "# 标题",
    },
    content: [
      {
        type: "text",
        text: "EACCES: permission denied, open '/Users/peng.li/workspace/freewind-mac-manager/README.md'",
      },
    ],
    error: "工具报告失败：目标文件只读。",
  },
  {
    id: "call-seed-6",
    serverId: "paseo",
    serverName: "paseo",
    kind: "tool",
    name: "list_agents",
    status: "ok",
    startedAt: NOW - 6 * MINUTE,
    durationMs: 88,
    request: {},
    content: [
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
    error: null,
  },
  {
    id: "call-seed-7",
    serverId: "donsetch",
    serverName: "donsetch",
    kind: "resource",
    name: "web_fetch",
    status: "ok",
    startedAt: NOW - 3 * MINUTE,
    durationMs: 742,
    request: {
      url: "https://modelcontextprotocol.io/docs",
      focus: "transport",
    },
    content: [
      {
        type: "text",
        text: "## Transports\n\nMCP 定义了两种标准传输：stdio 与 Streamable HTTP。stdio 用于本机进程，Streamable HTTP 用于远程服务……",
      },
    ],
    error: null,
  },
]
