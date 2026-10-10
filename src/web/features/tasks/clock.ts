import { useSyncExternalStore } from "react"

/**
 * 秒级时钟：只在有订阅者时才开始走动，用于展示已用时间。
 *
 * 已用时间不是进度，因此这里只提供时间本身，不参与任何百分比计算。
 */
let current = Math.floor(Date.now() / 1000)
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

const tick = (): void => {
  current = Math.floor(Date.now() / 1000)
  for (const listener of listeners) listener()
}

const start = (): void => {
  if (timer !== null) return
  timer = setInterval(tick, 1000)
}

const stop = (): void => {
  if (timer === null) return
  clearInterval(timer)
  timer = null
}

const subscribe = (onChange: () => void): (() => void) => {
  listeners.add(onChange)
  start()
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0) stop()
  }
}

const noopSubscribe = (): (() => void) => () => undefined

const getSnapshot = (): number => current

export const useClockSeconds = (enabled: boolean): number =>
  useSyncExternalStore(
    enabled ? subscribe : noopSubscribe,
    getSnapshot,
    getSnapshot
  )
