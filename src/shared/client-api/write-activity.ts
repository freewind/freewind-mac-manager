let active = 0
const listeners = new Set<() => void>()
const notify = () => {
  for (const listener of listeners) listener()
}
export const activeWriteCount = (): number => active
export const subscribeWrites = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
/** 只追踪当前传输，不保存载荷，也不产生待重放队列。 */
export const beginWrite = (): (() => void) => {
  active += 1
  notify()
  let ended = false
  return () => {
    if (ended) return
    ended = true
    active -= 1
    notify()
  }
}
