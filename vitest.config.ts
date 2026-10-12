import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const root = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@web": `${root}src/web`,
      "@server": `${root}src/server`,
      "@shared": `${root}src/shared`,
      // 与 vite.config.ts 保持一致：官方组件里的 next/dynamic 指向本地等价实现。
      "next/dynamic": `${root}src/web/lib/next-dynamic.tsx`,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
})
