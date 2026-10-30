import express from "express"
import { createApp } from "./app"
import {
  registerDatabaseUser,
  runStartupMaintenanceBarrier,
} from "./common/database-maintenance"
import { runPendingRestore } from "./database/backups/restore"
import { hasPendingRestoreWork } from "./database/backups/restore-plan"
import { startScheduler } from "./disk-growth/service"
import { resolveServerPort, WEB_DIST_DIR } from "./env"
import { createTaskRuntime } from "./tasks/runtime"
import { startTrafficSampler } from "./traffic/service"

/**
 * 启动顺序（不可调换）：
 * 1. 维护屏障：有恢复计划时先完成受控恢复——此时还没有任何业务连接；
 * 2. 登记本进程为数据库使用者（登记晚于恢复，否则会挡住自己）；
 * 3. 创建任务运行时与业务连接，最后才启动采样与调度。
 * 启动迁移在 createApp 内执行；迁移失败会直接抛错退出，
 * 因此不会出现“迁移失败却宣布恢复成功”的情况。
 */
const restoreOutcome = await runStartupMaintenanceBarrier({
  hasPendingWork: () => hasPendingRestoreWork(),
  executeRestore: () => runPendingRestore(),
})

const databaseUser = registerDatabaseUser("server")

// 任务运行时归属进程生命周期：退出时中止执行中的子进程，并把它们标成结果未知。
const tasks = createTaskRuntime()

const app = createApp({ tasks })
app.use(express.static(WEB_DIST_DIR))

// 走到这里说明启动迁移也成功了：只有此时才宣布恢复整体完成。
if (restoreOutcome?.status === "applied") {
  console.log(`[mac-manager] ${restoreOutcome.message}，启动迁移已通过`)
}

// 启动时先校验端口，缺失合法的 APP_PORT 就直接失败退出。
const port = resolveServerPort()

/**
 * 监听全部网卡：手机在同一局域网才能直接访问。
 * 安全边界是访问密码（未配置密码时接口 fail-closed），不是回环绑定。
 */
const BIND_HOST = "0.0.0.0"
const server = app.listen(port, BIND_HOST, () => {
  console.log(
    `[mac-manager] 服务已启动：http://127.0.0.1:${port}（监听 ${BIND_HOST}，局域网可直接访问）`
  )
  startScheduler(tasks.runner)
  startTrafficSampler()
})

// 端口来自 APP_PORT：被占用时直接启动失败，不自动换端口。
server.on("error", (error) => {
  console.error(`[mac-manager] 无法监听 ${BIND_HOST}:${port}：${error.message}`)
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
  databaseUser.unregister()
  process.exit(0)
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
