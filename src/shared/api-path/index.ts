export const API_BASE = "/api" as const

export const ApiPath = {
  authStatus: `${API_BASE}/auth/status`,
  authLogin: `${API_BASE}/auth/login`,
  health: `${API_BASE}/health`,
  clashVergeStatus: `${API_BASE}/clash-verge/status`,
  clashVergeProxies: `${API_BASE}/clash-verge/proxies`,
  clashVergeConnections: `${API_BASE}/clash-verge/connections`,
  /** 全局 Merge 文件（uid: Merge）读写：路径固定为 Clash Verge profiles/Merge.yaml，客户端不传路径。 */
  clashVergeMergeFile: `${API_BASE}/clash-verge/merge-file`,
  diskGrowthScans: `${API_BASE}/disk-growth/scans`,
  diskGrowthEntries: `${API_BASE}/disk-growth/entries`,
  diskGrowthTree: `${API_BASE}/disk-growth/tree`,
  diskGrowthScan: `${API_BASE}/disk-growth/scan`,
  diskGrowthReveal: `${API_BASE}/disk-growth/reveal`,
  diskGrowthEntry: `${API_BASE}/disk-growth/entry`,
  filesDirectory: `${API_BASE}/files/directory`,
  filesEntries: `${API_BASE}/files/entries`,
  filesEntryName: `${API_BASE}/files/entries/name`,
  filesEntriesCopy: `${API_BASE}/files/entries/copy`,
  filesEntriesMove: `${API_BASE}/files/entries/move`,
  filesDirectories: `${API_BASE}/files/directories`,
  filesContent: `${API_BASE}/files/content`,
  filesSearch: `${API_BASE}/files/search`,
  filesDownload: `${API_BASE}/files/download`,
  filesUploads: `${API_BASE}/files/uploads`,
  trafficStatus: `${API_BASE}/traffic/status`,
  trafficSnapshots: `${API_BASE}/traffic/snapshots`,
  trafficSnapshotsMerge: `${API_BASE}/traffic/snapshots/merge`,
  trafficGroups: `${API_BASE}/traffic/groups`,
  trafficProcessesKill: `${API_BASE}/traffic/processes/kill`,
  dashboardOverview: `${API_BASE}/dashboard/overview`,
  hardwareOverview: `${API_BASE}/hardware/overview`,
  dashboardProcesses: `${API_BASE}/dashboard/processes`,
  dashboardPorts: `${API_BASE}/dashboard/ports`,
  portsBindings: `${API_BASE}/ports/bindings`,
  portsProcessesKill: `${API_BASE}/ports/processes/kill`,
  processes: `${API_BASE}/processes`,
  processesKill: `${API_BASE}/processes/kill`,
  systemServices: `${API_BASE}/system-services/services`,
  systemService: `${API_BASE}/system-services/service`,
  systemServicesRun: `${API_BASE}/system-services/run`,
  systemServicesRestart: `${API_BASE}/system-services/restart`,
  systemServicesLoaded: `${API_BASE}/system-services/loaded`,
  systemServicesReveal: `${API_BASE}/system-services/reveal`,
  frpConfig: `${API_BASE}/frp/config`,
  frpProbe: `${API_BASE}/frp/probe`,
  caddyStatus: `${API_BASE}/caddy/status`,
  caddyRules: `${API_BASE}/caddy/rules`,
  caddyRule: `${API_BASE}/caddy/rules/:id`,
  caddyRulesImport: `${API_BASE}/caddy/rules/import`,
  caddyApply: `${API_BASE}/caddy/apply`,
  caddyVersions: `${API_BASE}/caddy/versions`,
  caddyVersionRestore: `${API_BASE}/caddy/versions/:id/restore`,
  piModels: `${API_BASE}/pi/models`,
  piModelGroups: `${API_BASE}/pi/model-groups`,
  piModelGroup: `${API_BASE}/pi/model-groups/:groupId`,
  piSettings: `${API_BASE}/pi/settings`,
  piBenchmarks: `${API_BASE}/pi/benchmarks`,
  piBenchmark: `${API_BASE}/pi/benchmarks/:id`,
  piLabRuns: `${API_BASE}/pi/lab/runs`,
  piLabRun: `${API_BASE}/pi/lab/runs/:id`,
  piLabCancel: `${API_BASE}/pi/lab/runs/:id/cancel`,
  piLabSession: `${API_BASE}/pi/lab/session`,
  piProvider: `${API_BASE}/pi/providers/:providerId`,
  aiAssistantSettings: `${API_BASE}/ai-assistant/settings`,
  aiAssistantSessions: `${API_BASE}/ai-assistant/sessions`,
  aiAssistantSession: `${API_BASE}/ai-assistant/sessions/:sessionId`,
  aiAssistantMessage: `${API_BASE}/ai-assistant/sessions/:sessionId/message`,
  aiAssistantExecution: `${API_BASE}/ai-assistant/executions/:executionId`,
  aiAssistantExecutionStop: `${API_BASE}/ai-assistant/executions/:executionId/stop`,
  /**
   * 执行事件订阅（SSE）。传输例外：事件不是真相来源，只是进度通知，
   * 重连后按同一个 executionId 重新订阅即可，不会重发原指令。
   */
  aiAssistantExecutionEvents: `${API_BASE}/ai-assistant/executions/:executionId/events`,
  dockerOverview: `${API_BASE}/docker/overview`,
  dockerContainers: `${API_BASE}/docker/containers`,
  dockerContainersAction: `${API_BASE}/docker/containers/action`,
  dockerContainersLogs: `${API_BASE}/docker/containers/logs`,
  dockerContainer: `${API_BASE}/docker/container`,
  dockerImages: `${API_BASE}/docker/images`,
  dockerImagesPull: `${API_BASE}/docker/images/pull`,
  dockerImage: `${API_BASE}/docker/image`,
  dockerVolumes: `${API_BASE}/docker/volumes`,
  dockerVolume: `${API_BASE}/docker/volume`,
  dockerNetworks: `${API_BASE}/docker/networks`,
  dockerNetwork: `${API_BASE}/docker/network`,
  dockerColima: `${API_BASE}/docker/colima`,
  dockerColimaAction: `${API_BASE}/docker/colima/action`,
  tasks: `${API_BASE}/tasks`,
  task: `${API_BASE}/tasks/:id`,
  databaseTables: `${API_BASE}/database/tables`,
  databaseTable: `${API_BASE}/database/tables/:table`,
  databaseRecords: `${API_BASE}/database/tables/:table/records`,
  databaseRecord: `${API_BASE}/database/tables/:table/record`,
  databaseRecordDelete: `${API_BASE}/database/tables/:table/records/delete`,
  databaseBackups: `${API_BASE}/database/backups`,
  databaseBackup: `${API_BASE}/database/backups/:backupId`,
  databaseBackupsDelete: `${API_BASE}/database/backups/delete`,
  databaseBackupRestore: `${API_BASE}/database/backups/restore`,
  /**
   * 文件传输例外（不进 JSON 契约）：
   * - 上传导入：multipart/form-data，单个文件不超过
   *   `DATABASE_BACKUP_UPLOAD_MAX_BYTES`（8GiB，按本机 1.8GB 库的几倍留余量），
   *   超出回 413；只接受 `.sqlite3` 且头部是 SQLite 格式的文件，否则 400；
   *   实现必须流式接收并在接收前检查目标磁盘可用空间，不得整文件读入内存；
   *   仍需访问密码（浏览器原生表单无法自设 Authorization，走 cookie）；
   *   上传时的原始文件名只用于展示，不能作为路径来源。
   */
  databaseBackupUpload: `${API_BASE}/database/backups/upload`,
  /**
   * 下载：返回 application/octet-stream 与 Content-Disposition，
   * 文件名取自服务端记录（不是客户端输入）；未登录 401，
   * 备份不存在 404，完整性不通过 409。
   * 备份文件是 GB 量级（当前库 1.8GB），同样必须流式发送，不能整文件读入内存。
   */
  databaseBackupDownload: `${API_BASE}/database/backups/:backupId/download`,
  collaborationTopics: `${API_BASE}/collaboration/topics`,
  collaborationTopic: `${API_BASE}/collaboration/topics/:topicId`,
  collaborationThreads: `${API_BASE}/collaboration/topics/:topicId/threads`,
  collaborationThread: `${API_BASE}/collaboration/topics/:topicId/threads/:threadId`,
  collaborationComments: `${API_BASE}/collaboration/topics/:topicId/threads/:threadId/comments`,
  collaborationComment: `${API_BASE}/collaboration/topics/:topicId/threads/:threadId/comments/:commentId`,
  collaborationSearch: `${API_BASE}/collaboration/search`,
  collaborationEvents: `${API_BASE}/collaboration/events`,
} as const

export type ApiPathKey = keyof typeof ApiPath
export type ApiPathValue = (typeof ApiPath)[ApiPathKey]

/** contract 用：去掉 API_BASE 前缀。 */
export function toContractPath(value: ApiPathValue): string {
  return (
    (value.startsWith(API_BASE) ? value.slice(API_BASE.length) : value) || "/"
  )
}
