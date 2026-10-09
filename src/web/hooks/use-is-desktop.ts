import { useSyncExternalStore } from "react"

export const DESKTOP_BREAKPOINT = 768

const subscribe = (onChange: () => void) => {
  if (typeof window === "undefined") return () => undefined
  const media = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}

const getSnapshot = () =>
  typeof window !== "undefined"
    ? window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`).matches
    : false

const getServerSnapshot = () => false

export const useIsDesktop = () =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
