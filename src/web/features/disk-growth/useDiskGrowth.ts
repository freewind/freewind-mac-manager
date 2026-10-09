import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { GrowthEntry, ScanSnapshot, ScanStatus } from "@shared/api-contract"
import {
  fetchEntries,
  fetchScanStatus,
  fetchScans,
  triggerScan,
} from "@shared/client-api"
import {
  isMockMode,
  mockEntries,
  mockNextSnapshot,
  mockScanPhases,
  mockSnapshots,
  mockStatus,
} from "@web/features/disk-growth/mock-data"

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const useDiskGrowth = () => {
  const mock = useMemo(() => isMockMode(), [])
  const [snapshots, setSnapshots] = useState<ScanSnapshot[]>([])
  const [scanId, setScanId] = useState<number | null>(null)
  const [path, setPath] = useState("")
  const [keyword, setKeyword] = useState("")
  const [entries, setEntries] = useState<GrowthEntry[]>([])
  const [current, setCurrent] = useState<GrowthEntry | null>(null)
  const [status, setStatus] = useState<ScanStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wasRunning = useRef(false)
  const mockTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (mockTimer.current) clearInterval(mockTimer.current)
    }
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const next = await fetchScanStatus()
      setStatus(next)
      if (wasRunning.current && !next.running) {
        const data = await fetchScans()
        setSnapshots(data.snapshots)
        setScanId(data.snapshots[0]?.id ?? null)
      }
      wasRunning.current = next.running
    } catch (caught) {
      setError(toMessage(caught))
    }
  }, [])

  const loadSnapshots = useCallback(async () => {
    try {
      const data = await fetchScans()
      setSnapshots(data.snapshots)
      setScanId((previous) => previous ?? data.snapshots[0]?.id ?? null)
    } catch (caught) {
      setError(toMessage(caught))
    }
  }, [])

  const loadEntries = useCallback(async () => {
    if (scanId == null) {
      setEntries([])
      setCurrent(null)
      return
    }
    setLoading(true)
    try {
      const trimmed = keyword.trim()
      const data = await fetchEntries({
        scanId,
        path,
        keyword: trimmed.length > 0 ? trimmed : undefined,
      })
      setEntries(data.entries)
      setCurrent(data.current)
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [scanId, path, keyword])

  // Mock 数据：直接当作本地数据源，不触碰后端。
  useEffect(() => {
    if (!mock) return
    const loaded = mockSnapshots()
    setSnapshots(loaded)
    setScanId(loaded[0]?.id ?? null)
    setStatus(mockStatus(loaded[0]))
  }, [mock])

  useEffect(() => {
    if (mock) return
    void loadSnapshots()
    void refreshStatus()
  }, [mock, loadSnapshots, refreshStatus])

  useEffect(() => {
    if (mock) {
      const data = mockEntries(path)
      setEntries(data.entries)
      setCurrent(data.current)
      setLoading(false)
      return
    }
    void loadEntries()
  }, [mock, loadEntries, path])

  useEffect(() => {
    if (mock) return
    const timer = setInterval(() => {
      void refreshStatus()
    }, 2000)
    return () => clearInterval(timer)
  }, [mock, refreshStatus])

  const scanNow = useCallback(async () => {
    if (mock) {
      const phases = mockScanPhases()
      const latest = snapshots[0]
      setStatus({
        running: true,
        phase: "准备中",
        startedAt: Date.now() / 1000,
        finishedAt: null,
        scannedEntries: 0,
        lastError: null,
      })
      let index = 0
      if (mockTimer.current) clearInterval(mockTimer.current)
      mockTimer.current = setInterval(() => {
        if (index < phases.length) {
          const phase = phases[index]
          index += 1
          setStatus((previous) =>
            previous ? { ...previous, phase } : previous
          )
          return
        }
        if (mockTimer.current) clearInterval(mockTimer.current)
        mockTimer.current = null
        const next = mockNextSnapshot(latest)
        setSnapshots((previous) => [next, ...previous])
        setScanId(next.id)
        setStatus({
          running: false,
          phase: `扫描完成，快照 #${next.id}`,
          startedAt: next.startedAt,
          finishedAt: next.finishedAt ?? next.startedAt,
          scannedEntries: next.fileCount,
          lastError: null,
        })
      }, 700)
      return
    }
    try {
      const result = await triggerScan()
      if (!result.started) setError(result.message)
      await refreshStatus()
    } catch (caught) {
      setError(toMessage(caught))
    }
  }, [mock, refreshStatus, snapshots])

  const enterDirectory = useCallback((target: GrowthEntry) => {
    setKeyword("")
    setPath(target.path)
  }, [])

  const goTo = useCallback((target: string) => {
    setKeyword("")
    setPath(target)
  }, [])

  const goUp = useCallback(() => {
    setPath((previous) => {
      if (previous === "" || previous === "/") return ""
      const index = previous.lastIndexOf("/")
      return index <= 0 ? "" : previous.slice(0, index)
    })
  }, [])

  return {
    isMock: mock,
    snapshots,
    scanId,
    setScanId,
    path,
    keyword,
    setKeyword,
    entries,
    current,
    status,
    loading,
    error,
    clearError: () => setError(null),
    enterDirectory,
    goTo,
    goUp,
    scanNow,
    breadcrumbs: buildBreadcrumbs(path),
  }
}

const buildBreadcrumbs = (path: string): { title: string; path: string }[] => {
  if (path === "") return [{ title: "根", path: "" }]
  const crumbs = [{ title: "根", path: "" }]
  const parts = path.split("/").filter(Boolean)
  let accumulated = ""
  for (const part of parts) {
    accumulated += `/${part}`
    crumbs.push({ title: part, path: accumulated })
  }
  return crumbs
}
