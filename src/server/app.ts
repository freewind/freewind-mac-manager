import { createExpressEndpoints } from "@ts-rest/express"
import express from "express"
import { authContract, createAuthManager, createAuthRouter } from "./auth"
import { caddyContract, createCaddyRouter } from "./caddy/handlers"
import { clashVergeContract, clashVergeRouter } from "./clash-verge/handlers"
import { dashboardContract, dashboardRouter } from "./dashboard/handlers"
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
  createExpressEndpoints(authContract, createAuthRouter(auth), app, options)
  app.use(auth.middleware)
  createExpressEndpoints(healthContract, healthRouter, app, options)
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
  createExpressEndpoints(processesContract, processesRouter, app, options)
  createExpressEndpoints(
    systemServicesContract,
    createSystemServicesRouter(taskRuntime),
    app,
    options
  )
  // 迁库与采样只在应用进程里做；后台执行器不会重复执行它们。
  if (injected?.initializeBusiness !== false) initializeTraffic()
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
