// @vitest-environment jsdom

import { beginWrite } from "@shared/client-api/write-activity"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, expect, it, vi } from "vitest"
import { usePwaStatus } from "./use-pwa-status"

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
it("checks active writes at update time before activating the waiting worker", async () => {
  vi.stubEnv("PROD", true)
  const message = vi.fn()
  const registration = Object.assign(new EventTarget(), {
    waiting: { postMessage: message },
  })
  const workers = Object.assign(new EventTarget(), {
    register: vi.fn(async () => registration),
    controller: {},
  })
  vi.stubGlobal("navigator", { onLine: true, serviceWorker: workers })
  const client = new QueryClient()
  const { result } = renderHook(() => usePwaStatus(false), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
  await waitFor(() => expect(result.current.updateAvailable).toBe(true))
  const endWrite = beginWrite()
  act(() => result.current.applyUpdate())
  expect(message).not.toHaveBeenCalled()
  endWrite()
  act(() => result.current.applyUpdate())
  expect(message).toHaveBeenCalledWith({ type: "SKIP_WAITING" })
  client.clear()
})
