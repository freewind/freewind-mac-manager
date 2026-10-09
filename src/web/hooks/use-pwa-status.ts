import { useSyncExternalStore } from "react"

type PwaState = {
  online: boolean
  updateAvailable: boolean
  applyUpdate: () => void
}

let waitingWorker: ServiceWorker | null = null
let waitingInitialized = false
const waitingListeners = new Set<() => void>()

const notifyWaiting = (worker: ServiceWorker | null) => {
  waitingWorker = worker
  for (const listener of waitingListeners) listener()
}

const observeRegistration = (registration: ServiceWorkerRegistration) => {
  if (registration.waiting) notifyWaiting(registration.waiting)
  registration.addEventListener("updatefound", () => {
    const installing = registration.installing
    if (!installing) return
    installing.addEventListener("statechange", () => {
      if (
        installing.state === "installed" &&
        navigator.serviceWorker.controller
      ) {
        notifyWaiting(registration.waiting ?? installing)
      }
    })
  })
}

const initializeWaitingStore = () => {
  if (
    waitingInitialized ||
    !import.meta.env.PROD ||
    !("serviceWorker" in navigator)
  ) {
    return
  }
  waitingInitialized = true
  void navigator.serviceWorker.register("/sw.js").then(observeRegistration)
}

const subscribeWaiting = (onChange: () => void) => {
  waitingListeners.add(onChange)
  initializeWaitingStore()
  return () => waitingListeners.delete(onChange)
}

const getWaiting = () => waitingWorker
const getWaitingServer = () => null

const subscribeOnline = (onChange: () => void) => {
  window.addEventListener("online", onChange)
  window.addEventListener("offline", onChange)
  return () => {
    window.removeEventListener("online", onChange)
    window.removeEventListener("offline", onChange)
  }
}

const getOnline = () => navigator.onLine
const getOnlineServer = () => true

export const usePwaStatus = (): PwaState => {
  const online = useSyncExternalStore(
    subscribeOnline,
    getOnline,
    getOnlineServer
  )
  const waiting = useSyncExternalStore(
    subscribeWaiting,
    getWaiting,
    getWaitingServer
  )

  const applyUpdate = () => {
    if (!waiting) return
    const reload = () => window.location.reload()
    navigator.serviceWorker.addEventListener("controllerchange", reload, {
      once: true,
    })
    waiting.postMessage({ type: "SKIP_WAITING" })
  }

  return { online, updateAvailable: waiting !== null, applyUpdate }
}
