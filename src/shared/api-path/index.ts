export const API_BASE = "/api" as const

export const ApiPath = {
  [`${API_BASE}/auth/csrf`]: `${API_BASE}/auth/csrf`,
  [`${API_BASE}/auth/status`]: `${API_BASE}/auth/status`,
  [`${API_BASE}/auth/login`]: `${API_BASE}/auth/login`,
  [`${API_BASE}/auth/logout`]: `${API_BASE}/auth/logout`,
  [`${API_BASE}/health`]: `${API_BASE}/health`,
  [`${API_BASE}/disk-growth/scans`]: `${API_BASE}/disk-growth/scans`,
  [`${API_BASE}/disk-growth/entries`]: `${API_BASE}/disk-growth/entries`,
  [`${API_BASE}/disk-growth/scan-status`]: `${API_BASE}/disk-growth/scan-status`,
  [`${API_BASE}/disk-growth/tree`]: `${API_BASE}/disk-growth/tree`,
  [`${API_BASE}/disk-growth/scan`]: `${API_BASE}/disk-growth/scan`,
  [`${API_BASE}/disk-growth/reveal`]: `${API_BASE}/disk-growth/reveal`,
  [`${API_BASE}/disk-growth/entry`]: `${API_BASE}/disk-growth/entry`,
  [`${API_BASE}/files/directory`]: `${API_BASE}/files/directory`,
  [`${API_BASE}/files/entries`]: `${API_BASE}/files/entries`,
  [`${API_BASE}/files/entries/name`]: `${API_BASE}/files/entries/name`,
  [`${API_BASE}/files/entries/copy`]: `${API_BASE}/files/entries/copy`,
  [`${API_BASE}/files/entries/move`]: `${API_BASE}/files/entries/move`,
  [`${API_BASE}/files/directories`]: `${API_BASE}/files/directories`,
  [`${API_BASE}/files/content`]: `${API_BASE}/files/content`,
  [`${API_BASE}/files/download`]: `${API_BASE}/files/download`,
  [`${API_BASE}/files/uploads`]: `${API_BASE}/files/uploads`,
  [`${API_BASE}/traffic/status`]: `${API_BASE}/traffic/status`,
  [`${API_BASE}/traffic/snapshots`]: `${API_BASE}/traffic/snapshots`,
  [`${API_BASE}/traffic/snapshots/merge`]: `${API_BASE}/traffic/snapshots/merge`,
  [`${API_BASE}/traffic/groups`]: `${API_BASE}/traffic/groups`,
  [`${API_BASE}/traffic/processes/kill`]: `${API_BASE}/traffic/processes/kill`,
  [`${API_BASE}/dashboard/overview`]: `${API_BASE}/dashboard/overview`,
  [`${API_BASE}/dashboard/processes`]: `${API_BASE}/dashboard/processes`,
  [`${API_BASE}/dashboard/ports`]: `${API_BASE}/dashboard/ports`,
  [`${API_BASE}/ports/bindings`]: `${API_BASE}/ports/bindings`,
  [`${API_BASE}/ports/processes/kill`]: `${API_BASE}/ports/processes/kill`,
  [`${API_BASE}/processes`]: `${API_BASE}/processes`,
  [`${API_BASE}/processes/kill`]: `${API_BASE}/processes/kill`,
  [`${API_BASE}/system-services/services`]: `${API_BASE}/system-services/services`,
  [`${API_BASE}/system-services/service`]: `${API_BASE}/system-services/service`,
  [`${API_BASE}/system-services/run`]: `${API_BASE}/system-services/run`,
  [`${API_BASE}/system-services/restart`]: `${API_BASE}/system-services/restart`,
  [`${API_BASE}/system-services/loaded`]: `${API_BASE}/system-services/loaded`,
  [`${API_BASE}/system-services/reveal`]: `${API_BASE}/system-services/reveal`,
  [`${API_BASE}/frp/config`]: `${API_BASE}/frp/config`,
  [`${API_BASE}/frp/probe`]: `${API_BASE}/frp/probe`,
} as const

export type ApiPathKey = keyof typeof ApiPath

/** contract 用：去掉 API_BASE 前缀 */
export function toContractPath(key: ApiPathKey): string {
  const text = String(key)
  return (text.startsWith(API_BASE) ? text.slice(API_BASE.length) : text) || "/"
}
