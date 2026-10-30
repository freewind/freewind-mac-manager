import type { Express } from "express"
import type { Plugin } from "vite"

type ConnectMiddleware = (
  request: unknown,
  response: unknown,
  next: () => void
) => void

/** server 与契约变化都要重建 app，否则改了代码路由仍是旧的。 */
const RELOADED_PREFIXES = ["src/server/", "src/shared/"]

/** 这些前缀交给后端 app：/api 是接口，/models 是语音识别模型文件。 */
const BACKEND_PREFIXES = ["/api", "/models"]

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

    // ssrLoadModule 只让模块图失效，缓存住的 Express 实例不会自己换上新路由。
    // 所以文件一变就丢掉缓存，下一次请求用最新代码重建 app。
    const root = server.config.root
    const dropCachedApp = (file: string): void => {
      const relative = (
        file.startsWith(root) ? file.slice(root.length + 1) : file
      ).replaceAll("\\", "/")
      if (RELOADED_PREFIXES.some((prefix) => relative.startsWith(prefix))) {
        appPromise = null
      }
    }
    server.watcher.on("change", dropCachedApp)
    server.watcher.on("add", dropCachedApp)
    server.watcher.on("unlink", dropCachedApp)

    server.middlewares.use((request, response, next) => {
      if (!BACKEND_PREFIXES.some((prefix) => request.url?.startsWith(prefix))) {
        next()
        return
      }
      void loadApp()
        .then((app) => {
          const handle = app as unknown as ConnectMiddleware
          handle(request, response, next)
        })
        .catch((error: unknown) => {
          // app 建不起来时不能把请求挂在半空：交给 Vite 兜底会让页面
          // 拿到 HTML 当成接口数据，前端渲染时直接崩溃。
          console.error("[mac-manager] 后端 app 加载失败", error)
          response.statusCode = 502
          response.setHeader("content-type", "application/json; charset=utf-8")
          response.end(JSON.stringify({ message: "后端接口加载失败" }))
        })
    })
  },
})
