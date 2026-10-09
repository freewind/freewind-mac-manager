import express from "express"
import { createExpressEndpoints } from "@ts-rest/express"
import { authRoutes } from "@shared/api-contract/routes/auth"
import { createAuthManager, createAuthRouter } from "./auth"
import { healthContract, healthRouter } from "./health/handlers"
import { dashboardContract, dashboardRouter } from "./dashboard/handlers"
import { diskGrowthContract, diskGrowthRouter } from "./disk-growth/handlers"
import {
  filesContract,
  filesRouter,
  registerUploadEndpoint,
} from "./files/handlers"
import { frpContract, frpRouter } from "./frp/handlers"
import { portsContract, portsRouter } from "./ports/handlers"
import { processesContract, processesRouter } from "./processes/handlers"
import {
  systemServicesContract,
  systemServicesRouter,
} from "./system-services/handlers"
import { trafficContract, trafficRouter } from "./traffic/handlers"
import { startTrafficSampler } from "./traffic/service"

/** dev 与生产共用的 Express 应用（中间件形态，不监听端口）。 */
export const createApp = (): express.Express => {
  const app = express()
  // 文件管理的删除接口用数组 query，ts-rest client 发的是 paths[0]=… ，
  // 只有 extended parser 才能把它还原成数组。
  app.set("query parser", "extended")
  // 默认 100kb 装不下文件内容保存的正文，这里放宽到 32mb（服务只监听本机）。
  app.use(express.json({ limit: "32mb" }))
  // 不开 jsonQuery：client 默认发普通 query string，schema 里用 z.coerce 接收数字。
  const options = { logInitialization: false }
  const auth = createAuthManager()
  createExpressEndpoints(authRoutes, createAuthRouter(auth), app, options)
  app.use(auth.middleware)
  createExpressEndpoints(healthContract, healthRouter, app, options)
  createExpressEndpoints(diskGrowthContract, diskGrowthRouter, app, options)
  createExpressEndpoints(dashboardContract, dashboardRouter, app, options)
  createExpressEndpoints(portsContract, portsRouter, app, options)
  createExpressEndpoints(trafficContract, trafficRouter, app, options)
  createExpressEndpoints(processesContract, processesRouter, app, options)
  createExpressEndpoints(filesContract, filesRouter, app, options)
  createExpressEndpoints(
    systemServicesContract,
    systemServicesRouter,
    app,
    options
  )
  createExpressEndpoints(frpContract, frpRouter, app, options)
  registerUploadEndpoint(app)

  // dev 模式下 api 中间件只加载 createApp，采样在这里启动（重复调用是幂等的）。
  startTrafficSampler()
  return app
}
