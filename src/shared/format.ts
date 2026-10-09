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

export const formatTimestamp = (seconds: number): string => {
  const date = new Date(seconds * 1000)
  const pad = (input: number): string => String(input).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
