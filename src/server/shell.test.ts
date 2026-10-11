import { readFileSync } from "node:fs"
import vm from "node:vm"
import { expect, it, vi } from "vitest"

it("only serves the pinned shell and never caches API or arbitrary files", async () => {
  const listeners = new Map<
    string,
    (event: {
      request: { url: string; method: string; destination: string }
      respondWith: ReturnType<typeof vi.fn>
    }) => void
  >()
  const match = vi.fn(async () => "pinned")
  const fetch = vi.fn()
  vm.runInNewContext(
    readFileSync("public/sw.js", "utf8").replace(
      '["__SHELL_URLS__"]',
      '["/index.html", "/assets/a.js"]'
    ),
    {
      self: {
        location: { origin: "https://test" },
        addEventListener: (
          name: string,
          handler: typeof listeners extends Map<string, infer H> ? H : never
        ) => listeners.set(name, handler),
      },
      caches: { open: async () => ({ match }) },
      URL,
      fetch,
    }
  )
  const handle = listeners.get("fetch")
  if (!handle) throw new Error("缺少fetch handler")
  for (const pathname of ["/api/files/content", "/unknown.txt"]) {
    const respondWith = vi.fn()
    handle({
      request: {
        url: `https://test${pathname}`,
        method: "GET",
        destination: "script",
      },
      respondWith,
    })
    expect(respondWith).not.toHaveBeenCalled()
  }
  const respondWith = vi.fn()
  handle({
    request: {
      url: "https://test/?feature=files",
      method: "GET",
      destination: "document",
    },
    respondWith,
  })
  await respondWith.mock.calls[0][0]
  expect(match).toHaveBeenCalledWith("/index.html")
  expect(fetch).not.toHaveBeenCalled()
})
