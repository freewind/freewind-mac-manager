import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { devApiPlugin } from "./api-middleware.ts"
import { resolveServerPort } from "./src/server/env.ts"
import { openApiDocsPlugin } from "./vite-openapi-docs-plugin.ts"

const root = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig(({ command }) => ({
  plugins: [openApiDocsPlugin(), devApiPlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@web": `${root}src/web`,
      "@server": `${root}src/server`,
      "@shared": `${root}src/shared`,
      // 官方 agent-elements 里用到 next/dynamic；本项目是 Vite，用本地等价实现替掉。
      "next/dynamic": `${root}src/web/lib/next-dynamic.tsx`,
    },
  },
  // 端口来自 APP_PORT 且 strict：被占用时直接启动失败，不自动换端口。
  // host 用 0.0.0.0：手机在同一局域网可直接访问；安全边界靠访问密码，不靠回环绑定。
  server:
    command === "serve"
      ? { port: resolveServerPort(), strictPort: true, host: "0.0.0.0" }
      : undefined,
  build: {
    outDir: "dist",
    // 服务端要产出两个入口（主进程与任务执行子进程），第二次构建不能清空第一次的产物。
    emptyOutDir: process.env.VITE_KEEP_OUT_DIR === "1" ? false : undefined,
  },
}))
