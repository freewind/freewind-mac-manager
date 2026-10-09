import fs from "node:fs"
import path from "node:path"

/** 向上查找含 package.json 的目录作为项目根，源码与产物两种位置都成立。 */
const findRoot = (start: string): string => {
  let dir = start
  for (;;) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error("[mac-manager] 未向上找到 package.json，项目根定位失败")
    }
    dir = parent
  }
}

export const PROJECT_ROOT = findRoot(import.meta.dirname)
export const WEB_DIST_DIR = path.join(PROJECT_ROOT, "dist")
export const DATA_DIR = path.join(PROJECT_ROOT, "data")
export const DATABASE_FILE = path.join(DATA_DIR, "snapshots.sqlite3")

/** 端口必须由环境变量显式指定，缺失或非法直接抛错，不做兜底。 */
export const resolveServerPort = (): number => {
  const port = Number(process.env.APP_PORT)
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(
      "[mac-manager] 缺少合法的 APP_PORT 环境变量（端口必须显式指定）"
    )
  }
  return port
}
