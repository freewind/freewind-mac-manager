import { createReadStream, existsSync, readFileSync } from "node:fs"
import { extname, join } from "node:path"
import type { Plugin } from "vite"
import { PROJECT_ROOT } from "./src/server/env.ts"

const SWAGGER_DIST = join(PROJECT_ROOT, "node_modules", "swagger-ui-dist")
const OPENAPI_PATH = join(PROJECT_ROOT, "generated", "openapi.yaml")

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".yaml": "application/yaml; charset=utf-8",
  ".yml": "application/yaml; charset=utf-8",
}

const indexHtml = (): string => `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mac Manager API Docs</title>
    <link rel="stylesheet" href="/api-docs/swagger-ui.css" />
    <style>body { margin: 0; }</style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/api-docs/swagger-ui-bundle.js"></script>
    <script src="/api-docs/swagger-ui-standalone-preset.js"></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({
          url: "/api-docs/openapi.yaml",
          dom_id: "#swagger-ui",
          deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
          layout: "StandaloneLayout",
        })
      }
    </script>
  </body>
</html>`

/** dev：同端口提供 Swagger UI，/api 仍走 API 中间件。 */
export const openApiDocsPlugin = (): Plugin => ({
  name: "openapi-docs",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const rawUrl = request.url ?? ""
      if (!rawUrl.startsWith("/api-docs")) {
        next()
        return
      }

      const pathname = rawUrl.split("?")[0] ?? ""

      if (pathname === "/api-docs/openapi.yaml") {
        if (!existsSync(OPENAPI_PATH)) {
          response.statusCode = 404
          response.end("generated/openapi.yaml 不存在，请先跑 pnpm generate:openapi")
          return
        }
        response.setHeader("Content-Type", MIME[".yaml"] ?? "application/yaml")
        response.end(readFileSync(OPENAPI_PATH, "utf8"))
        return
      }

      if (pathname === "/api-docs" || pathname === "/api-docs/") {
        response.setHeader("Content-Type", MIME[".html"] ?? "text/html")
        response.end(indexHtml())
        return
      }

      if (!pathname.startsWith("/api-docs/")) {
        next()
        return
      }

      const assetName = pathname.slice("/api-docs/".length)
      if (!assetName || assetName.includes("..")) {
        response.statusCode = 404
        response.end("Not found")
        return
      }

      const filePath = join(SWAGGER_DIST, assetName)
      if (!filePath.startsWith(SWAGGER_DIST) || !existsSync(filePath)) {
        response.statusCode = 404
        response.end("Not found")
        return
      }

      response.setHeader("Content-Type", MIME[extname(filePath)] ?? "application/octet-stream")
      createReadStream(filePath).pipe(response)
    })
  },
})
