import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { generateOpenApi } from "@ts-rest/open-api"
import { stringify } from "yaml"
import { contract } from "@shared/api-contract"

const projectRoot = join(import.meta.dirname, "..")
const outputPath = join(projectRoot, "generated", "openapi.yaml")

const document = generateOpenApi(contract, {
  info: {
    title: "Freewind Mac Manager",
    version: "0.0.1",
  },
  // contract 的 pathPrefix 已把 /api 加回 path，所以 server 用同源根路径。
  servers: [{ url: "/", description: "同源（dev 与生产都共用一个端口）" }],
})

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, stringify(document))

console.log(`已写出 ${outputPath}`)
