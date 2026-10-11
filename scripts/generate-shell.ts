import { createHash } from "node:crypto"
import { readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const root = process.cwd()
const dist = path.join(root, "dist")
const assets = (await readdir(path.join(dist, "assets"))).sort()
const urls = [
  "/index.html",
  "/manifest.webmanifest",
  "/mac-manager-icon.svg",
  ...assets.map((name) => `/assets/${name}`),
]
const hash = createHash("sha256")
for (const url of urls) hash.update(await readFile(path.join(dist, url)))
const version = hash.digest("hex").slice(0, 20)
const template = await readFile(path.join(root, "public/sw.js"), "utf8")
await writeFile(
  path.join(dist, "sw.js"),
  template
    .replace('"__SHELL_VERSION__"', JSON.stringify(version))
    .replace('["__SHELL_URLS__"]', JSON.stringify(urls))
)
