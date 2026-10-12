/**
 * 任务作用域（冲突判定用的 target）的唯一来源。
 *
 * 文件任务的展示目标与前端待核实记录共用；真正互斥可另用 lock target，
 * 不应为实现粗粒度锁而丢失任务中心中的具体对象信息。
 */
export const scanTaskTarget = (root: string): string => `scan:${root}`

/** 文件单项写操作的展示目标。 */
export const fileDirectoryTarget = (parentPath: string): string =>
  `files:dir:${encodeURIComponent(parentPath)}`

/** 文件批量操作的展示目标，路径排序使请求展示稳定。 */
export const fileTaskTarget = (paths: string[]): string =>
  `files:${[...paths].sort().map(encodeURIComponent).join("|")}`

/** 文件修改共用域级冲突键，覆盖重叠路径和路径别名。 */
export const fileMutationLockTarget = (): string => "files:mutations"

/** 在访达显示不修改文件内容，不与文件写操作竞争。 */
export const fileRevealTaskTarget = (target: string): string =>
  `files:reveal:${encodeURIComponent(target)}`

/** 系统服务按域与 label 加锁。 */
export const serviceTaskTarget = (domain: string, label: string): string =>
  `service:${domain}/${label}`

/** 流量快照的写操作共用一个域级锁：它们互相依赖同一份增量链。 */
export const trafficSnapshotTaskTarget = (): string => "traffic:snapshots"

/** FRP 配置写入按配置文件加锁。 */
export const frpConfigTaskTarget = (): string => "frp:config"

/** Caddy 只有一份配置文件，所有应用动作互斥。 */
export const caddyConfigTaskTarget = (): string => "caddy:config"

/** Docker 容器动作按容器加锁：同容器互斥，不同容器可并行。 */
export const dockerContainerTaskTarget = (id: string): string =>
  `docker:container:${id}`

/** 镜像动作按镜像引用加锁（拉取与删除共用）。 */
export const dockerImageTaskTarget = (ref: string): string =>
  `docker:image:${ref}`

/** 卷删除按卷名加锁。 */
export const dockerVolumeTaskTarget = (name: string): string =>
  `docker:volume:${name}`

/** 网络删除按网络 id 加锁。 */
export const dockerNetworkTaskTarget = (id: string): string =>
  `docker:network:${id}`

/** Colima 虚拟机是全局资源，任何动作都相互排斥（任务 9 接入）。 */
export const dockerColimaTaskTarget = (): string => "docker:colima"

/**
 * 数据库备份读取整库，因此共用一把域级锁：同一时间只跑一个备份，
 * 避免两份备份重复读盘、互相抢磁盘空间。
 */
export const databaseBackupTaskTarget = (): string => "database:backup"
