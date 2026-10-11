import { useEffect, useId, useRef } from "react"

type OverlayHistoryState = { macManagerOverlays?: string[] }
const stackOf = (state: unknown): string[] => {
  if (
    typeof state !== "object" ||
    state === null ||
    !("macManagerOverlays" in state)
  )
    return []
  const stack = (state as OverlayHistoryState).macManagerOverlays
  return Array.isArray(stack)
    ? stack.filter((id): id is string => typeof id === "string")
    : []
}

/** 历史状态记录每层归属，返回只关闭已离开历史栈的浮层。 */
export const useHistoryOverlay = (open: boolean, onClose: () => void) => {
  const id = useId()
  const wasOpen = useRef(false)
  const mounted = useRef(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const stack = stackOf(window.history.state)
    if (open && !wasOpen.current) {
      window.history.pushState(
        { ...window.history.state, macManagerOverlays: [...stack, id] },
        "",
        window.location.href
      )
    }
    if (!open && wasOpen.current) {
      if (stack.at(-1) === id) window.history.back()
      else if (stack.includes(id)) {
        window.history.replaceState(
          {
            ...window.history.state,
            macManagerOverlays: stack.filter((item) => item !== id),
          },
          "",
          window.location.href
        )
      }
    }
    wasOpen.current = open
  }, [open, id])
  useEffect(() => {
    mounted.current = true
    const onPopState = (event: PopStateEvent) => {
      if (wasOpen.current && !stackOf(event.state).includes(id)) {
        wasOpen.current = false
        onCloseRef.current()
      }
    }
    window.addEventListener("popstate", onPopState)
    return () => {
      window.removeEventListener("popstate", onPopState)
      mounted.current = false
      queueMicrotask(() => {
        if (mounted.current) return
        const stack = stackOf(window.history.state)
        if (stack.includes(id)) {
          window.history.replaceState(
            {
              ...window.history.state,
              macManagerOverlays: stack.filter((item) => item !== id),
            },
            "",
            window.location.href
          )
        }
      })
    }
  }, [id])
}
