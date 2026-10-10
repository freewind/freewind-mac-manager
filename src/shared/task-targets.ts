/**
 * 任务作用域（冲突判定用的 target）的唯一来源。
 *
 * 服务端用它加锁，客户端把它记进「待核实请求」用于展示与恢复；两边必须是同一份
 * 字符串，因此放在 shared 里而不是各写一份。
 */
export const scanTaskTarget = (root: string): string => `scan:${root}`

/**
 * 单个条目操作（新建、改名）按父目录加锁：这样它们与批量任务落在同一目录时
 * 能互相拦住，而不是各自为政。
 */
export const fileDirectoryTarget = (parentPath: string): string =>
  `files:dir:${parentPath}`

/** 文件批量操作按目标目录加锁。 */
export const fileTaskTarget = (paths: string[]): string =>
  `files:${[...paths].sort().join("\u0000")}`

/** 系统服务按域与 label 加锁。 */
export const serviceTaskTarget = (domain: string, label: string): string =>
  `service:${domain}/${label}`

/** 流量快照的写操作共用一个域级锁：它们互相依赖同一份增量链。 */
export const trafficSnapshotTaskTarget = (): string => "traffic:snapshots"

/** FRP 配置写入按配置文件加锁。 */
export const frpConfigTaskTarget = (): string => "frp:config"
