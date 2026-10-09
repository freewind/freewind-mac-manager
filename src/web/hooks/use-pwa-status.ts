import { useEffect, useState } from "react"

type PwaState = {
  online: boolean
  updateAvailable: boolean
  applyUpdate: () => void
}

export const usePwaStatus = (): PwaState => {
  const [online, setOnline] = useState(() => navigator.onLine)
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    const setOnlineState = () => setOnline(navigator.onLine)
    window.addEventListener("online", setOnlineState)
    window.addEventListener("offline", setOnlineState)

    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
      return () => {
        window.removeEventListener("online", setOnlineState)
        window.removeEventListener("offline", setOnlineState)
      }
    }

    let disposed = false

    const observeRegistration = (current: ServiceWorkerRegistration) => {
      if (current.waiting) setWaiting(current.waiting)
      current.addEventListener("updatefound", () => {
        const installing = current.installing
        if (!installing) return
        installing.addEventListener("statechange", () => {
          if (
            !disposed &&
            installing.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            setWaiting(current.waiting ?? installing)
          }
        })
      })
    }

    void navigator.serviceWorker.register("/sw.js").then(observeRegistration)

    return () => {
      disposed = true
      window.removeEventListener("online", setOnlineState)
      window.removeEventListener("offline", setOnlineState)
    }
  }, [])

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
