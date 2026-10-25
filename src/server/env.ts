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
/** 单库文件：默认在项目 data 目录，可用 MAC_MANAGER_DB_FILE 覆盖（测试指向临时文件）。 */
export const DATABASE_FILE = path.resolve(
  process.env.MAC_MANAGER_DB_FILE ?? path.join(DATA_DIR, "snapshots.sqlite3")
)
export const PI_AGENT_DIR = path.resolve(
  process.env.PI_CODING_AGENT_DIR ??
    path.join(process.env.HOME ?? "", ".pi", "agent")
)

/**
 * 应用配置的唯一来源：项目根的 .env。启动时加载一次，覆盖 dev、生产与脚本。
 * 已存在的进程环境变量优先于文件，便于临时覆盖。
 */
const ENV_FILE = path.join(PROJECT_ROOT, ".env")
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE)

export const env = {
  get CLASH_VERGE_CONTROLLER_URL() {
    return process.env.CLASH_VERGE_CONTROLLER_URL
  },
  /**
   * 控制接口的 unix socket 路径（Clash Verge 服务模式下内核只开 socket）。
   * 配了就优先用它，不再自动发现。
   */
  get CLASH_VERGE_CONTROLLER_UNIX_SOCKET() {
    return process.env.CLASH_VERGE_CONTROLLER_UNIX_SOCKET
  },
  /** 填 0 关闭控制接口自动发现，只认显式配置的地址。 */
  get CLASH_VERGE_AUTO_DISCOVER() {
    return process.env.CLASH_VERGE_AUTO_DISCOVER
  },
  get CLASH_VERGE_SECRET() {
    return process.env.CLASH_VERGE_SECRET
  },
}

/**
 * Clash Verge Rev 的 profiles 目录：全局 Merge（uid: Merge）就在其中。
 * 默认取本机常规安装位置，可用 CLASH_VERGE_PROFILE_DIR 覆盖（测试指向临时目录）。
 */
export const CLASH_VERGE_PROFILE_DIR = path.resolve(
  process.env.CLASH_VERGE_PROFILE_DIR ??
    path.join(
      process.env.HOME ?? "",
      "Library",
      "Application Support",
      "io.github.clash-verge-rev.clash-verge-rev",
      "profiles"
    )
)

/**
 * 全局 Merge 文件：固定叫 Merge.yaml，路径由服务端推导，不接受客户端传路径；
 * 可用 CLASH_VERGE_MERGE_FILE 单独覆盖（测试与换机器用）。
 */
export const CLASH_VERGE_MERGE_FILE = path.resolve(
  process.env.CLASH_VERGE_MERGE_FILE ??
    path.join(CLASH_VERGE_PROFILE_DIR, "Merge.yaml")
)

/**
 * profiles.yaml：Clash Verge 的订阅清单（订阅 URL 与流量信息都在里面），
 * 位于 profiles 目录的上一层。Clash Verge 不对外提供订阅 API，只能读这份文件。
 * 可用 CLASH_VERGE_PROFILES_FILE 单独覆盖（测试与换机器用）。
 */
export const CLASH_VERGE_PROFILES_FILE = path.resolve(
  process.env.CLASH_VERGE_PROFILES_FILE ??
    path.join(path.dirname(CLASH_VERGE_PROFILE_DIR), "profiles.yaml")
)

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
 * Caddy 的配置、程序与访问入口：默认取用户主目录下的常规安装位置，
 * 都允许用同名环境变量覆盖，便于换机器或测试指向临时文件。
 */
export const CADDY_CONFIG_FILE = path.resolve(
  process.env.CADDY_CONFIG_FILE ??
    path.join(process.env.HOME ?? "", ".config", "caddy", "Caddyfile")
)
export const CADDY_BINARY = path.resolve(
  process.env.CADDY_BINARY ?? path.join(process.env.HOME ?? "", "bin", "caddy")
)
export const CADDY_ADMIN_URL =
  process.env.CADDY_ADMIN_URL ?? "http://127.0.0.1:2019"
/** launchd 标签是本机固定事实，不提供覆盖。 */
export const CADDY_LAUNCHD_LABEL = "com.freewind.caddy"

/** Caddy 配置备份目录：应用前先留一份原文，失败时能还原。 */
export const CADDY_BACKUP_DIR = path.join(DATA_DIR, "caddy-backups")

/**
 * 应用库的备份目录：默认放项目 data 下，可用 MAC_MANAGER_BACKUP_DIR 覆盖
 * （测试指向临时目录）。备份文件与清单都只在这里，不写回被备份的库。
 */
export const DATABASE_BACKUP_DIR = path.resolve(
  process.env.MAC_MANAGER_BACKUP_DIR ?? path.join(DATA_DIR, "database-backups")
)

/**
 * 备份维护状态目录：恢复计划、进行中标记等维护信息，与备份文件分开存放，
 * 避免维护状态混进可下载的备份产物里。
 */
export const DATABASE_BACKUP_STATE_DIR = path.resolve(
  process.env.MAC_MANAGER_BACKUP_STATE_DIR ??
    path.join(DATA_DIR, "database-backup-state")
)

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
const DATABASE_QUERY_WORKER_SOURCE = path.join(
  PROJECT_ROOT,
  "src/server/database/query-worker.ts"
)
const DATABASE_QUERY_WORKER_DIST = path.join(
  PROJECT_ROOT,
  "dist-ssr/server/query-worker.js"
)
const MUTATION_WORKER_SOURCE = path.join(
  PROJECT_ROOT,
  "src/server/database/mutation-worker.ts"
)
const MUTATION_WORKER_DIST = path.join(
  PROJECT_ROOT,
  "dist-ssr/server/mutation-worker.js"
)
const BACKUP_VALIDATION_WORKER_SOURCE = path.join(
  PROJECT_ROOT,
  "src/server/database/backups/validation-worker.ts"
)
const BACKUP_VALIDATION_WORKER_DIST = path.join(
  PROJECT_ROOT,
  "dist-ssr/server/validation-worker.js"
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

/**
 * 数据库查询子进程的启动方式，与任务子进程同一套判断：
 * 开发直接跑源码（不依赖构建产物），生产跑 dist-ssr 里的产物。
 */
export const databaseQueryWorkerCommand = (): {
  command: string
  args: string[]
  cwd: string
} =>
  IS_PRODUCTION
    ? {
        command: process.execPath,
        args: [DATABASE_QUERY_WORKER_DIST],
        cwd: PROJECT_ROOT,
      }
    : {
        command: process.execPath,
        args: ["--import", "tsx", DATABASE_QUERY_WORKER_SOURCE],
        cwd: PROJECT_ROOT,
      }

/**
 * 数据库写子进程的启动方式，与查询子进程同一套判断：
 * 开发直接跑源码（不依赖构建产物），生产跑 dist-ssr 里的产物。
 */
export const mutationWorkerCommand = (): {
  command: string
  args: string[]
  cwd: string
} =>
  IS_PRODUCTION
    ? {
        command: process.execPath,
        args: [MUTATION_WORKER_DIST],
        cwd: PROJECT_ROOT,
      }
    : {
        command: process.execPath,
        args: ["--import", "tsx", MUTATION_WORKER_SOURCE],
        cwd: PROJECT_ROOT,
      }

/**
 * 备份校验子进程的启动方式，与查询、写子进程同一套判断：
 * 开发直接跑源码（不依赖构建产物），生产跑 dist-ssr 里的产物。
 */
export const databaseBackupValidationWorkerCommand = (): {
  command: string
  args: string[]
  cwd: string
} =>
  IS_PRODUCTION
    ? {
        command: process.execPath,
        args: [BACKUP_VALIDATION_WORKER_DIST],
        cwd: PROJECT_ROOT,
      }
    : {
        command: process.execPath,
        args: ["--import", "tsx", BACKUP_VALIDATION_WORKER_SOURCE],
        cwd: PROJECT_ROOT,
      }
