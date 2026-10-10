import { createExpressEndpoints } from "@ts-rest/express"
import express from "express"
import { dashboardContract, dashboardRouter } from "./dashboard/handlers"
import {
  createDiskGrowthRouter,
  diskGrowthContract,
} from "./disk-growth/handlers"
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
import { createTrafficRouter, trafficContract } from "./traffic/handlers"
import { initializeTraffic, startTrafficSampler } from "./traffic/service"

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
  // 任务运行时先建好：长任务端点（如磁盘扫描）需要提交任务。
  const taskRuntime = injected?.tasks ?? createTaskRuntime()
  createExpressEndpoints(healthContract, healthRouter, app, options)
  createExpressEndpoints(dashboardContract, dashboardRouter, app, options)
  createExpressEndpoints(
    diskGrowthContract,
    createDiskGrowthRouter(taskRuntime),
    app,
    options
  )
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
  // 迁库与采样只在应用进程里做；后台执行器不会重复执行它们。
  initializeTraffic()
  createExpressEndpoints(
    trafficContract,
    createTrafficRouter(taskRuntime),
    app,
    options
  )

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
