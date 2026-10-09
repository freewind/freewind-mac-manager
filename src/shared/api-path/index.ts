export const API_BASE = "/api" as const

export const ApiPath = {
  [`${API_BASE}/health`]: `${API_BASE}/health`,
  [`${API_BASE}/disk-growth/scans`]: `${API_BASE}/disk-growth/scans`,
  [`${API_BASE}/disk-growth/entries`]: `${API_BASE}/disk-growth/entries`,
  [`${API_BASE}/disk-growth/scan-status`]: `${API_BASE}/disk-growth/scan-status`,
  [`${API_BASE}/disk-growth/scan`]: `${API_BASE}/disk-growth/scan`,
  [`${API_BASE}/ports/bindings`]: `${API_BASE}/ports/bindings`,
  [`${API_BASE}/ports/processes/kill`]: `${API_BASE}/ports/processes/kill`,
} as const

export type ApiPathKey = keyof typeof ApiPath

/** contract 用：去掉 API_BASE 前缀 */
export function toContractPath(key: ApiPathKey): string {
  const text = String(key)
  return (text.startsWith(API_BASE) ? text.slice(API_BASE.length) : text) || "/"
}
