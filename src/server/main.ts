import fs from "node:fs"
import https from "node:https"
import express from "express"
import { createApp } from "./app"
import { startScheduler } from "./disk-growth/service"
import {
  HTTPS_CERT_FILE,
  HTTPS_KEY_FILE,
  resolveServerPort,
  SERVER_HOST,
  WEB_DIST_DIR,
} from "./env"
import { createTaskRuntime } from "./tasks/runtime"
import { startTrafficSampler } from "./traffic/service"

// 任务运行时归属进程生命周期：退出时中止执行中的子进程，并把它们标成结果未知。
const tasks = createTaskRuntime()

const app = createApp({ tasks })
app.use(express.static(WEB_DIST_DIR))

// 启动时先校验端口，缺失合法的 APP_PORT 就直接失败退出。
const port = resolveServerPort()

const server = https
  .createServer(
    {
      cert: fs.readFileSync(HTTPS_CERT_FILE),
      key: fs.readFileSync(HTTPS_KEY_FILE),
    },
    app
  )
  .listen(port, SERVER_HOST, () => {
    console.log(`[mac-manager] 服务已启动：https://${SERVER_HOST}:${port}`)
    startScheduler(tasks.runner)
    startTrafficSampler()
  })

// 端口来自 APP_PORT：被占用时直接启动失败，不自动换端口。
server.on("error", (error) => {
  console.error(
    `[mac-manager] 无法监听 ${SERVER_HOST}:${port}：${error.message}`
  )
  process.exit(1)
})

/**
 * 关闭时先停止接收新请求，再中止执行中的任务。
 *
 * 中止不等价于失败：结果无法确认的任务会被标成未知，重启后不会自动重做。
 */
const shutdown = (signal: string): void => {
  console.log(`[mac-manager] 收到 ${signal}，正在停止服务`)
  server.close()
  tasks.runner.shutdown()
  tasks.store.close()
  process.exit(0)
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
