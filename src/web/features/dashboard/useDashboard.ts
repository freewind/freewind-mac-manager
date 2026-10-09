import { useCallback, useEffect, useRef, useState } from "react"
import { createMockOverview, type Overview } from "./mock-data"

/** 概览数据源：先给一份立即渲染，之后每 3 秒换一份新的采样值。 */
export const useDashboard = () => {
  const tickRef = useRef(0)
  const [overview, setOverview] = useState<Overview>(() =>
    createMockOverview(0)
  )
  const [paused, setPaused] = useState(false)

  const refresh = useCallback(() => {
    tickRef.current += 1
    setOverview(createMockOverview(tickRef.current))
  }, [])

  useEffect(() => {
    if (paused) return
    const timer = setInterval(refresh, 3000)
    return () => clearInterval(timer)
  }, [paused, refresh])

  return { overview, refresh, paused, setPaused }
}
