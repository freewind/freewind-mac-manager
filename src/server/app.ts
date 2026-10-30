import { createExpressEndpoints } from "@ts-rest/express"
import express from "express"
import {
  aiAssistantContract,
  createAiAssistantRouter,
  registerAiAssistantStreamEndpoint,
} from "./ai-assistant/handlers"
import {
  aiTopicContract,
  createAiTopicRouter,
  registerAiTopicStreamEndpoint,
} from "./ai-assistant/topic-handlers"
import {
  aiCallContract,
  createAiCallRouter,
  registerAiCallStreamEndpoint,
} from "./ai-call/handlers"
import { authContract, createAuthManager, createAuthRouter } from "./auth"
import { caddyContract, createCaddyRouter } from "./caddy/handlers"
import { clashVergeContract, clashVergeRouter } from "./clash-verge/handlers"
import { registerCollaborationEventEndpoint } from "./collaboration/events"
import {
  collaborationContract,
  createCollaborationRouter,
} from "./collaboration/handlers"
import { CollaborationStore } from "./collaboration/store"
import { dashboardContract, dashboardRouter } from "./dashboard/handlers"
import {
  createDatabaseBackupsRouter,
  databaseBackupContract,
  registerDatabaseBackupTransferEndpoints,
} from "./database/backups/handlers"
import { reconcileDatabaseBackupsAtStartup } from "./database/backups/service"
import {
  createDatabaseRouter,
  createDatabaseService,
  type DatabaseService,
  databaseContract,
} from "./database/handlers"
import {
  createDiskGrowthRouter,
  diskGrowthContract,
} from "./disk-growth/handlers"
import { createDockerRouter, dockerContract } from "./docker/handlers"
import { createDockerService, type DockerServiceCli } from "./docker/service"
import {
  createFilesRouter,
  filesContract,
  registerUploadEndpoint,
} from "./files/handlers"
import { createFrpRouter, frpContract } from "./frp/handlers"
import { hardwareContract, hardwareRouter } from "./hardware/handlers"
import { healthContract, healthRouter } from "./health/handlers"
import {
  createMcpServersRouter,
  mcpServersContract,
} from "./mcp-servers/handlers"
import { getMcpRuntime } from "./mcp-servers/runtime"
import {
  createMcpServersService,
  type McpServersService,
} from "./mcp-servers/service"
import { getMcpServerStore } from "./mcp-servers/store"
import { createPiRouter, piContract } from "./pi/handlers"
import { portsContract, portsRouter } from "./ports/handlers"
import { processesContract, processesRouter } from "./processes/handlers"
import {
  createSystemServicesRouter,
  systemServicesContract,
} from "./system-services/handlers"
import { createTasksRouter, tasksContract } from "./tasks/handlers"
import { createTaskRuntime, type TaskRuntime } from "./tasks/runtime"
import { createTrafficRouter, trafficContract } from "./traffic/handlers"
import { initializeTraffic, startTrafficSampler } from "./traffic/service"

/** dev 与生产共用的 Express 应用（中间件形态，不监听端口）。 */
export const createApp = (injected?: {
  /** 注入任务运行时；缺省时使用真实数据库与子进程执行器。测试可传受控替身。 */
  tasks?: TaskRuntime
  /** HTTP 测试关闭业务迁移与采样；生产默认执行初始化。 */
  initializeBusiness?: boolean
  /**
   * 仅测试使用：替换 Docker 域的只读/预检查执行层，
   * 让集成测试不必碰真实 docker（动作条目由测试自己用同一替身执行）。
   */
  dockerCli?: DockerServiceCli
  /**
   * 仅测试使用：替换 database 域的服务（真实实现是查询/写入子进程）。
   * 不注入时也不会在启动阶段碰真实业务库：子进程只在请求到来时才启动。
   */
  database?: DatabaseService
  /**
   * 仅测试使用：替换 MCP Servers 域服务。缺省时用进程级单例的 store 与
   * 运行时；运行时是单例，dev 重建 app 不会把旧连接变成没人关的孤儿。
   */
  mcpServers?: McpServersService
  /**
   * 仅测试使用：替换协作数据存储。缺省时使用 env.DATABASE_FILE 指向的库。
   */
  collaboration?: CollaborationStore
}): express.Express => {
  const app = express()
  // 文件管理的删除接口用数组 query，ts-rest client 发的是 paths[0]=… ，
  // 只有 extended parser 才能把它还原成数组。
  app.set("query parser", "extended")
  // 默认 100kb 装不下文件内容保存的正文，这里放宽到 32mb（服务只监听本机）。
  app.use(express.json({ limit: "32mb" }))
  // 不开 jsonQuery：client 默认发普通 query string，schema 里用 z.coerce 接收数字。
  const options = { logInitialization: false }
  // 任务运行时先建好：长任务端点（如磁盘扫描）需要提交任务。
  const taskRuntime = injected?.tasks ?? createTaskRuntime()
  const auth = createAuthManager()
  createExpressEndpoints(authContract, createAuthRouter(), app, options)
  app.use(auth.middleware)
  createExpressEndpoints(healthContract, healthRouter, app, options)
  createExpressEndpoints(
    mcpServersContract,
    createMcpServersRouter(
      injected?.mcpServers ??
        createMcpServersService({
          store: getMcpServerStore(),
          runtime: getMcpRuntime(),
        })
    ),
    app,
    options
  )
  createExpressEndpoints(hardwareContract, hardwareRouter, app, options)
  createExpressEndpoints(clashVergeContract, clashVergeRouter, app, options)
  createExpressEndpoints(dashboardContract, dashboardRouter, app, options)
  createExpressEndpoints(
    diskGrowthContract,
    createDiskGrowthRouter(taskRuntime),
    app,
    options
  )
  createExpressEndpoints(
    filesContract,
    createFilesRouter(taskRuntime),
    app,
    options
  )
  registerUploadEndpoint(app)
  // 备份管理：JSON 端点走契约；上传下载是传输例外，独立挂载。
  createExpressEndpoints(
    databaseBackupContract,
    createDatabaseBackupsRouter(taskRuntime),
    app,
    options
  )
  registerDatabaseBackupTransferEndpoints(app)
  // Docker 容器动作走统一任务运行时；只读端点不需要。
  createExpressEndpoints(
    dockerContract,
    createDockerRouter(createDockerService(injected?.dockerCli), taskRuntime),
    app,
    options
  )
  createExpressEndpoints(
    frpContract,
    createFrpRouter(taskRuntime),
    app,
    options
  )
  // Caddy 的应用与恢复要改真实配置，需进任务运行时；其余只读端点不需要。
  createExpressEndpoints(
    caddyContract,
    createCaddyRouter(taskRuntime),
    app,
    options
  )
  createExpressEndpoints(portsContract, portsRouter, app, options)
  createExpressEndpoints(piContract, createPiRouter(taskRuntime), app, options)
  createExpressEndpoints(
    aiAssistantContract,
    createAiAssistantRouter(),
    app,
    options
  )
  registerAiAssistantStreamEndpoint(app)
  createExpressEndpoints(aiTopicContract, createAiTopicRouter(), app, options)
  registerAiTopicStreamEndpoint(app)
  createExpressEndpoints(aiCallContract, createAiCallRouter(), app, options)
  registerAiCallStreamEndpoint(app)
  createExpressEndpoints(processesContract, processesRouter, app, options)
  createExpressEndpoints(
    systemServicesContract,
    createSystemServicesRouter(taskRuntime),
    app,
    options
  )
  // 迁库与采样只在应用进程里做；后台执行器不会重复执行它们。
  if (injected?.initializeBusiness !== false) initializeTraffic()
  // 启动时保守核实备份目录：孤儿临时文件、未确认发布、被改坏的清单。
  if (injected?.initializeBusiness !== false)
    reconcileDatabaseBackupsAtStartup()
  createExpressEndpoints(
    trafficContract,
    createTrafficRouter(taskRuntime),
    app,
    options
  )

  // 任务查询在鉴权之后挂载：任务里会带本机路径，不能公开。
  createExpressEndpoints(
    tasksContract,
    createTasksRouter(taskRuntime.store),
    app,
    options
  )

  // 通用数据管理同样在鉴权之后：库里的内容不允许未登录读取或修改。
  createExpressEndpoints(
    databaseContract,
    createDatabaseRouter(injected?.database ?? createDatabaseService()),
    app,
    options
  )

  // 协作数据与任务库同库，访问一律经 CollaborationStore，不在路由里写 SQL。
  createExpressEndpoints(
    collaborationContract,
    createCollaborationRouter(
      injected?.collaboration ?? new CollaborationStore()
    ),
    app,
    options
  )
  // SSE 是传输例外：事件不是真相来源，客户端必须重新读取真实数据。
  registerCollaborationEventEndpoint(app)

  // /api 未命中任何端点时必须回 JSON 404。dev 下它会接着交给 Vite
  // 兜底返回 index.html，生产下会回 Express 默认的 HTML 404；两种情况
  // 都会让客户端把页面当成接口数据，前端渲染时直接白屏。
  app.use((request, response, next) => {
    if (!request.path.startsWith("/api")) {
      next()
      return
    }
    response
      .status(404)
      .json({ message: `接口不存在：${request.method} ${request.path}` })
  })

  // dev 模式下 api 中间件只加载 createApp，采样在这里启动（重复调用是幂等的）。
  if (injected?.initializeBusiness !== false) startTrafficSampler()
  return app
}
