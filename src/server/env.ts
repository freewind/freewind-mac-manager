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

/** 登录密码只从 .env 读取；未配置时返回空串，由调用方按“未配置”处理。 */
export const getAuthPassword = (): string =>
  process.env.MAC_MANAGER_PASSWORD ?? ""

export const isAuthConfigured = (): boolean => getAuthPassword() !== ""

/**
 * 文件管理可访问的根目录：默认整个文件系统，可用 FILE_ROOT 收窄到某个子目录。
 * 所有文件接口的入参路径都必须落在它之下。
 */
export const FILE_ROOT = path.resolve(process.env.FILE_ROOT ?? "/")

/**
 * 服务端口固定为 51510：写死而不是读环境变量，避免同一台机器上跑出第二个实例
 * 各自采样、把同一份数据库写花。dev（vite strictPort）与生产（listen）都要求
 * 端口被占用时直接启动失败。
 */
export const SERVER_PORT = 51510
