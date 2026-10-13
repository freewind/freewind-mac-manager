const UNITS = ["B", "KB", "MB", "GB", "TB"] as const

export const formatBytes = (value: number): string => {
  if (value === 0) return "0"
  let remaining = Math.abs(value)
  let unit = 0
  while (remaining >= 1024 && unit < UNITS.length - 1) {
    remaining /= 1024
    unit += 1
  }
  const digits = unit === 0 ? 0 : remaining >= 100 ? 0 : 1
  return `${remaining.toFixed(digits)} ${UNITS[unit]}`
}

export const formatSignedBytes = (value: number): string => {
  if (value === 0) return "0"
  return `${value > 0 ? "+" : "-"}${formatBytes(value)}`
}

export const describeError = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message
  return "操作失败"
}

export const formatTimestamp = (seconds: number): string => {
  const date = new Date(seconds * 1000)
  const pad = (input: number): string => String(input).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 毫秒耗时统一按秒展示：一位小数并带单位，避免测速结果出现
 * `1503.049139 ms` 这种读不出来的原始浮点。耗时未知时用占位符，不留空值。
 */
export const formatToSeconds = (milliseconds: number | null): string =>
  milliseconds === null ? "—" : `${(milliseconds / 1000).toFixed(1)} s`
