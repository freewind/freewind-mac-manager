import { readFileSync } from "node:fs"
import vm from "node:vm"
import { expect, it, vi } from "vitest"

type WorkerEvent = {
  waitUntil: (promise: Promise<unknown>) => void
  data?: { type: string }
}
it("preloads the complete shell, waits for explicit activation and removes older caches", async () => {
  const listeners = new Map<string, (event: WorkerEvent) => void>()
  const addAll = vi.fn(async () => undefined)
  const remove = vi.fn(async () => true)
  const claim = vi.fn(async () => undefined)
  const skipWaiting = vi.fn()
  vm.runInNewContext(
    readFileSync("public/sw.js", "utf8")
      .replace('"__SHELL_VERSION__"', '"audit"')
      .replace('["__SHELL_URLS__"]', '["/index.html", "/assets/a.js"]'),
    {
      self: {
        addEventListener: (
          name: string,
          handler: (event: WorkerEvent) => void
        ) => listeners.set(name, handler),
        clients: { claim },
        skipWaiting,
      },
      caches: {
        open: async () => ({ addAll }),
        keys: async () => [
          "other",
          "mac-manager-shell-old",
          "mac-manager-shell-audit",
        ],
        delete: remove,
      },
    }
  )
  let work: Promise<unknown> = Promise.resolve()
  const waitUntil = (promise: Promise<unknown>) => {
    work = promise
  }
  listeners.get("install")?.({ waitUntil })
  await work
  expect(addAll).toHaveBeenCalledWith(["/index.html", "/assets/a.js"])
  expect(skipWaiting).not.toHaveBeenCalled()
  listeners.get("message")?.({ waitUntil, data: { type: "UNRELATED" } })
  expect(skipWaiting).not.toHaveBeenCalled()
  listeners.get("message")?.({ waitUntil, data: { type: "SKIP_WAITING" } })
  expect(skipWaiting).toHaveBeenCalledTimes(1)
  listeners.get("activate")?.({ waitUntil })
  await work
  expect(remove).toHaveBeenCalledTimes(1)
  expect(remove).toHaveBeenCalledWith("mac-manager-shell-old")
  expect(claim).toHaveBeenCalledTimes(1)
})
