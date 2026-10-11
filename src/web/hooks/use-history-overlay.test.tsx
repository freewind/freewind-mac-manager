// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { useHistoryOverlay } from "./use-history-overlay"

afterEach(cleanup)
it("closes only the top overlay when returning to the lower history entry", () => {
  window.history.replaceState({}, "", window.location.href)
  const closeLower = vi.fn()
  const closeUpper = vi.fn()
  renderHook(() => useHistoryOverlay(true, closeLower))
  const lowerState = window.history.state
  renderHook(() => useHistoryOverlay(true, closeUpper))
  act(() =>
    window.dispatchEvent(new PopStateEvent("popstate", { state: lowerState }))
  )
  expect(closeUpper).toHaveBeenCalledTimes(1)
  expect(closeLower).not.toHaveBeenCalled()
  act(() => window.dispatchEvent(new PopStateEvent("popstate", { state: {} })))
  expect(closeLower).toHaveBeenCalledTimes(1)
  expect(closeUpper).toHaveBeenCalledTimes(1)
})
