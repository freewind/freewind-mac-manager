import express from "express"
import { createApp } from "./app"
import { startScheduler } from "./disk-growth/service"
import { WEB_DIST_DIR, resolveServerPort } from "./env"

const app = createApp()
app.use(express.static(WEB_DIST_DIR))

const port = resolveServerPort()
app.listen(port, () => {
  console.log(`[mac-manager] 服务已启动：http://127.0.0.1:${port}`)
  startScheduler()
})
