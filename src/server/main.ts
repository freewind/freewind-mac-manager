import express from "express"
import { createApp } from "./app"
import { startScheduler } from "./disk-growth/service"
import { SERVER_PORT, WEB_DIST_DIR } from "./env"
import { createTaskRuntime } from "./tasks/runtime"
import { startTrafficSampler } from "./traffic/service"

// 任务运行时归属进程生命周期：退出时中止执行中的子进程，并把它们标成结果未知。
const tasks = createTaskRuntime()

const app = createApp({ tasks })
app.use(express.static(WEB_DIST_DIR))

// 不提供应用层访问门禁，只绑定本机回环地址，绝不暴露到局域网。
const server = app.listen(SERVER_PORT, "127.0.0.1", () => {
  console.log(`[mac-manager] 服务已启动：http://127.0.0.1:${SERVER_PORT}`)
  startScheduler(tasks.runner)
  startTrafficSampler()
})

// 端口固定：被占用时直接启动失败，不自动换端口。
server.on("error", (error) => {
  console.error(
    `[mac-manager] 无法监听 127.0.0.1:${SERVER_PORT}：${error.message}`
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
