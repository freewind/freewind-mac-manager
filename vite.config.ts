import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { devApiPlugin } from "./api-middleware.ts"
import { resolveServerPort } from "./src/server/env.ts"

const root = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), devApiPlugin()],
  resolve: {
    alias: {
      "@web": `${root}src/web`,
      "@server": `${root}src/server`,
      "@shared": `${root}src/shared`,
    },
  },
  // 只有 dev server 需要端口；build 不读 APP_PORT，因此不做兜底值。
  server:
    command === "serve"
      ? { port: resolveServerPort(), strictPort: true }
      : undefined,
  build: {
    outDir: "dist",
  },
}))
