export const API_BASE = "/api" as const

export const ApiPath = {
  authCsrf: `${API_BASE}/auth/csrf`,
  authStatus: `${API_BASE}/auth/status`,
  authLogin: `${API_BASE}/auth/login`,
  authLogout: `${API_BASE}/auth/logout`,
  health: `${API_BASE}/health`,
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
  filesDownload: `${API_BASE}/files/download`,
  filesUploads: `${API_BASE}/files/uploads`,
  trafficStatus: `${API_BASE}/traffic/status`,
  trafficSnapshots: `${API_BASE}/traffic/snapshots`,
  trafficSnapshotsMerge: `${API_BASE}/traffic/snapshots/merge`,
  trafficGroups: `${API_BASE}/traffic/groups`,
  trafficProcessesKill: `${API_BASE}/traffic/processes/kill`,
  dashboardOverview: `${API_BASE}/dashboard/overview`,
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
  tasks: `${API_BASE}/tasks`,
  task: `${API_BASE}/tasks/:id`,
} as const

export type ApiPathKey = keyof typeof ApiPath
export type ApiPathValue = (typeof ApiPath)[ApiPathKey]

/** contract 用：去掉 API_BASE 前缀。 */
export function toContractPath(value: ApiPathValue): string {
  return (
    (value.startsWith(API_BASE) ? value.slice(API_BASE.length) : value) || "/"
  )
}
