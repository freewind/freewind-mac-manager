import { useEffect, useRef } from "react"

type OverlayHistoryState = {
  macManagerOverlay?: boolean
}

const isOverlayHistory = (state: unknown): boolean =>
  typeof state === "object" &&
  state !== null &&
  "macManagerOverlay" in state &&
  (state as OverlayHistoryState).macManagerOverlay === true

/** 将可见浮层接入浏览器返回，关闭浮层后不留下重复历史记录。 */
export const useHistoryOverlay = (open: boolean, onClose: () => void) => {
  const wasOpen = useRef(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (open && !wasOpen.current) {
      window.history.pushState(
        { ...window.history.state, macManagerOverlay: true },
        "",
        window.location.href
      )
    }
    if (!open && wasOpen.current && isOverlayHistory(window.history.state)) {
      window.history.back()
    }
    wasOpen.current = open
  }, [open])

  useEffect(() => {
    const onPopState = (event: PopStateEvent): void => {
      if (wasOpen.current && !isOverlayHistory(event.state)) {
        onCloseRef.current()
      }
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])
}
