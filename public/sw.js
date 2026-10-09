const SHELL_CACHE = "mac-manager-shell-v1"
const SHELL_URLS = ["/", "/index.html", "/manifest.webmanifest"]
const STATIC_DESTINATIONS = new Set(["script", "style", "font", "image"])

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS))
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("mac-manager-shell-") && key !== SHELL_CACHE
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting()
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  ) {
    return
  }

  if (request.destination === "document") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          void caches
            .open(SHELL_CACHE)
            .then((cache) => cache.put(request, copy))
          return response
        })
        .catch(() => caches.match("/index.html"))
    )
    return
  }

  if (STATIC_DESTINATIONS.has(request.destination)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            const copy = response.clone()
            void caches
              .open(SHELL_CACHE)
              .then((cache) => cache.put(request, copy))
            return response
          })
      )
    )
  }
})
