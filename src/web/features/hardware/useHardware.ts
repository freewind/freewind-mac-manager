import { useState } from "react"
import { toast } from "sonner"
import { hardwareOverviewText } from "./display"
import { useHardwareOverview } from "./queries"

export const useHardware = () => {
  const query = useHardwareOverview()
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})

  const refresh = async (): Promise<void> => {
    await query.refetch()
  }

  const copy = async (): Promise<void> => {
    if (!query.data) return
    try {
      await navigator.clipboard.writeText(hardwareOverviewText(query.data))
      toast("已复制硬件概览文本，敏感字段已遮蔽")
    } catch {
      toast("复制失败，请检查浏览器剪贴板权限")
    }
  }

  const toggleSensitive = (key: string): void => {
    setRevealed((current) => ({ ...current, [key]: !current[key] }))
  }

  const exportText = (): void => {
    if (!query.data) return
    const blob = new Blob([hardwareOverviewText(query.data)], {
      type: "text/plain;charset=utf-8",
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "hardware-overview.txt"
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return { ...query, revealed, toggleSensitive, refresh, copy, exportText }
}
