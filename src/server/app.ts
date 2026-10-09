import express from "express"
import { createExpressEndpoints } from "@ts-rest/express"
import { contract } from "@shared/api-contract"
import { serverRouter } from "./disk-growth/handlers"

/** dev 与生产共用的 Express 应用（中间件形态，不监听端口）。 */
export const createApp = (): express.Express => {
  const app = express()
  app.use(express.json())
  createExpressEndpoints(contract, serverRouter, app, {
    jsonQuery: true,
    logInitialization: false,
  })
  return app
}
