import type { Express } from "express"
import type { Plugin } from "vite"

type ConnectMiddleware = (
  request: unknown,
  response: unknown,
  next: () => void
) => void

/**
 * dev 时把后端 API 作为中间件挂进 Vite dev server，页面与 /api 共用一个端口。
 *
 * 这里用 ssrLoadModule 动态加载 server 代码，而不是直接 import：
 * vite.config 由 esbuild 单独打包，拿不到 tsconfig/vite 的路径别名。
 */
export const devApiPlugin = (): Plugin => ({
  name: "dev-api-middleware",
  configureServer(server) {
    let appPromise: Promise<Express> | null = null
    const loadApp = (): Promise<Express> => {
      appPromise ??= server
        .ssrLoadModule("/src/server/app.ts")
        .then((module) => (module as { createApp: () => Express }).createApp())
      return appPromise
    }

    server.middlewares.use((request, response, next) => {
      if (!request.url?.startsWith("/api")) {
        next()
        return
      }
      void loadApp().then((app) => {
        const handle = app as unknown as ConnectMiddleware
        handle(request, response, next)
      })
    })
  },
})
