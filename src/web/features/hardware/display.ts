import type { HardwareOverview } from "@shared/api-contract"

export const formatHardwareValue = (
  value: string | number | boolean | null
): string => {
  if (value === null) return "未知"
  if (typeof value === "boolean") return value ? "是" : "否"
  return String(value)
}

export const formatHardwareBytes = (value: number | null): string => {
  if (value === null) return "未知"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let amount = value
  let unit = 0
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

export const maskMacAddress = (value: string): string =>
  "•".repeat(value.length)

export const maskSensitiveValue = (value: string): string => {
  if (value.length <= 4) return "•".repeat(value.length)
  return `${"•".repeat(Math.min(value.length - 4, 12))}${value.slice(-4)}`
}

const redactSensitiveFields = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactSensitiveFields)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      typeof child === "string" && /macAddress|address/i.test(key)
        ? maskMacAddress(child)
        : typeof child === "string" &&
            /serialNumber|hardwareUuid|provisioningUdid/i.test(key)
          ? maskSensitiveValue(child)
          : redactSensitiveFields(child),
    ])
  )
}

/** 导出完整九组信息，但敏感标识始终遮蔽，与页面默认状态一致。 */
export const hardwareOverviewText = (overview: HardwareOverview): string =>
  JSON.stringify(redactSensitiveFields(overview), null, 2)
