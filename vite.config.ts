import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { devApiPlugin } from "./api-middleware.ts"
import { SERVER_PORT } from "./src/server/env.ts"
import { openApiDocsPlugin } from "./vite-openapi-docs-plugin.ts"

const root = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig(({ command }) => ({
  plugins: [openApiDocsPlugin(), devApiPlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@web": `${root}src/web`,
      "@server": `${root}src/server`,
      "@shared": `${root}src/shared`,
    },
  },
  // 端口固定且 strict：被占用时直接启动失败，不自动换端口。
  server:
    command === "serve" ? { port: SERVER_PORT, strictPort: true } : undefined,
  build: {
    outDir: "dist",
    // 服务端要产出两个入口（主进程与任务执行子进程），第二次构建不能清空第一次的产物。
    emptyOutDir: process.env.VITE_KEEP_OUT_DIR === "1" ? false : undefined,
  },
}))
