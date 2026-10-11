const SHELL_CACHE = `mac-manager-shell-${"__SHELL_VERSION__"}`
const SHELL_URLS = ["__SHELL_URLS__"]

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
  )
    return
  const shellUrl =
    request.destination === "document" ? "/index.html" : url.pathname
  if (!SHELL_URLS.includes(shellUrl)) return
  event.respondWith(
    caches
      .open(SHELL_CACHE)
      .then(async (cache) => (await cache.match(shellUrl)) ?? fetch(request))
  )
})
