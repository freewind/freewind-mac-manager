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

/**
 * 应用配置的唯一来源：项目根的 .env。启动时加载一次，覆盖 dev、生产与脚本。
 * 已存在的进程环境变量优先于文件，便于临时覆盖。
 */
const ENV_FILE = path.join(PROJECT_ROOT, ".env")
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE)

export const SERVER_HOST = process.env.SERVER_HOST ?? "0.0.0.0"
export const HTTPS_CERT_FILE =
  process.env.HTTPS_CERT_FILE ??
  path.join(process.env.HOME ?? "", ".freewind-certs/192.168.1.59.pem")
export const HTTPS_KEY_FILE =
  process.env.HTTPS_KEY_FILE ??
  path.join(process.env.HOME ?? "", ".freewind-certs/192.168.1.59-key.pem")

/**
 * 文件管理可访问的根目录：默认整个文件系统，可用 FILE_ROOT 收窄到某个子目录。
 * 所有文件接口的入参路径都必须落在它之下。
 */
export const FILE_ROOT = path.resolve(process.env.FILE_ROOT ?? "/")

/**
 * 服务端口只由启动命令通过 APP_PORT 显式注入，代码里不留默认值：缺失或非法
 * 一律直接抛错，避免静默退化到别的端口。dev（vite strictPort）与生产（listen）
 * 都要求端口被占用时直接启动失败。
 *
 * 端口分档与具体取值见 package.json：dev 用 51509，生产（start）用 51510。
 */
export const resolveServerPort = (): number => {
  const port = Number(process.env.APP_PORT)
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(
      "[mac-manager] 缺少合法的 APP_PORT 环境变量（端口必须显式指定）"
    )
  }
  return port
}

const IS_PRODUCTION = process.env.NODE_ENV === "production"

const TASK_WORKER_SOURCE = path.join(PROJECT_ROOT, "src/server/task-worker.ts")
const TASK_WORKER_DIST = path.join(
  PROJECT_ROOT,
  "dist-ssr/server/task-worker.js"
)

/**
 * 后台任务子进程的启动方式。
 *
 * - 开发：直接用已安装的 tsx 运行源码，不需要先构建。
 * - 生产：运行构建产物，不依赖 tsx。
 *
 * 判断依据是显式的 NODE_ENV，而不是「产物是否存在」：本地残留的旧产物不能
 * 被开发服务当成现役代码使用。
 */
export const taskWorkerCommand = (): {
  command: string
  args: string[]
  cwd: string
} =>
  IS_PRODUCTION
    ? {
        command: process.execPath,
        args: [TASK_WORKER_DIST],
        cwd: PROJECT_ROOT,
      }
    : {
        command: process.execPath,
        args: ["--import", "tsx", TASK_WORKER_SOURCE],
        cwd: PROJECT_ROOT,
      }
