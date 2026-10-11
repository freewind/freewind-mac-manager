import { useEffect, useId, useSyncExternalStore } from "react"

const edits = new Set<string>()
const listeners = new Set<() => void>()
const notify = () => {
  for (const listener of listeners) listener()
}
export const hasProtectedEdits = () => edits.size > 0

/** 草稿可以跨页面存在，不随表单卸载释放；只在保存或明确放弃后清除。 */
export const publishDraftProtection = (key: string, active: boolean): void => {
  const id = `draft:${key}`
  if (active) edits.add(id)
  else edits.delete(id)
  notify()
}
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
