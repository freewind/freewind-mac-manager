import { createExpressEndpoints } from "@ts-rest/express"
import express from "express"
import { authContract, createAuthManager, createAuthRouter } from "./auth"
import { dashboardContract, dashboardRouter } from "./dashboard/handlers"
import { diskGrowthContract, diskGrowthRouter } from "./disk-growth/handlers"
import {
  filesContract,
  filesRouter,
  registerUploadEndpoint,
} from "./files/handlers"
import { frpContract, frpRouter } from "./frp/handlers"
import { healthContract, healthRouter } from "./health/handlers"
import { portsContract, portsRouter } from "./ports/handlers"
import { processesContract, processesRouter } from "./processes/handlers"
import {
  systemServicesContract,
  systemServicesRouter,
} from "./system-services/handlers"
import { createTasksRouter, tasksContract } from "./tasks/handlers"
import { createTaskRuntime, type TaskRuntime } from "./tasks/runtime"
import { trafficContract, trafficRouter } from "./traffic/handlers"
import { startTrafficSampler } from "./traffic/service"

/** dev 与生产共用的 Express 应用（中间件形态，不监听端口）。 */
export const createApp = (injected?: {
  /** 注入任务运行时；缺省时使用真实数据库与子进程执行器。测试可传受控替身。 */
  tasks?: TaskRuntime
}): express.Express => {
  const app = express()
  // 文件管理的删除接口用数组 query，ts-rest client 发的是 paths[0]=… ，
  // 只有 extended parser 才能把它还原成数组。
  app.set("query parser", "extended")
  // 默认 100kb 装不下文件内容保存的正文，这里放宽到 32mb（服务只监听本机）。
  app.use(express.json({ limit: "32mb" }))
  // 不开 jsonQuery：client 默认发普通 query string，schema 里用 z.coerce 接收数字。
  const options = { logInitialization: false }
  const auth = createAuthManager()
  createExpressEndpoints(authContract, createAuthRouter(auth), app, options)
  app.use(auth.middleware)
  createExpressEndpoints(healthContract, healthRouter, app, options)
  createExpressEndpoints(dashboardContract, dashboardRouter, app, options)
  createExpressEndpoints(diskGrowthContract, diskGrowthRouter, app, options)
  createExpressEndpoints(filesContract, filesRouter, app, options)
  registerUploadEndpoint(app)
  createExpressEndpoints(frpContract, frpRouter, app, options)
  createExpressEndpoints(portsContract, portsRouter, app, options)
  createExpressEndpoints(processesContract, processesRouter, app, options)
  createExpressEndpoints(
    systemServicesContract,
    systemServicesRouter,
    app,
    options
  )
  createExpressEndpoints(trafficContract, trafficRouter, app, options)

  // 任务查询在鉴权之后挂载：任务里会带本机路径，不能公开。
  const taskRuntime = injected?.tasks ?? createTaskRuntime()
  createExpressEndpoints(
    tasksContract,
    createTasksRouter(taskRuntime.store),
    app,
    options
  )

  // dev 模式下 api 中间件只加载 createApp，采样在这里启动（重复调用是幂等的）。
  startTrafficSampler()
  return app
}
