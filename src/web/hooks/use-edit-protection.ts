import { useEffect, useId, useSyncExternalStore } from "react"

const edits = new Set<string>()
const listeners = new Set<() => void>()
const notify = () => {
  for (const listener of listeners) listener()
}
export const hasProtectedEdits = () => edits.size > 0
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const useHasProtectedEdits = () =>
  useSyncExternalStore(subscribe, hasProtectedEdits, () => false)
export const useEditProtection = (active: boolean) => {
  const id = useId()
  useEffect(() => {
    if (!active) return
    edits.add(id)
    notify()
    return () => {
      edits.delete(id)
      notify()
    }
  }, [active, id])
}
