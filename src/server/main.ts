import express from "express"
import { createApp } from "./app"
import { startScheduler } from "./disk-growth/service"
import { SERVER_PORT, WEB_DIST_DIR } from "./env"
import { startTrafficSampler } from "./traffic/service"

const app = createApp()
app.use(express.static(WEB_DIST_DIR))

// 文件管理接口没有鉴权，因此只绑本机回环地址，绝不暴露到局域网。
const server = app.listen(SERVER_PORT, "127.0.0.1", () => {
  console.log(`[mac-manager] 服务已启动：http://127.0.0.1:${SERVER_PORT}`)
  startScheduler()
  startTrafficSampler()
})

// 端口固定：被占用时直接启动失败，不自动换端口。
server.on("error", (error) => {
  console.error(
    `[mac-manager] 无法监听 127.0.0.1:${SERVER_PORT}：${error.message}`
  )
  process.exit(1)
})
