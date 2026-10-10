// @vitest-environment jsdom

import { beginWrite } from "@shared/client-api/write-activity"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PwaStatus } from "./PwaStatus"

const { update } = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock("@web/hooks/use-pwa-status", () => ({
  usePwaStatus: () => ({
    online: true,
    updateAvailable: true,
    applyUpdate: update,
  }),
}))
vi.mock("@web/features/tasks/queries", () => ({
  useActiveTasks: () => ({
    data: { tasks: [] },
    isLoading: false,
    isError: false,
  }),
}))
afterEach(() => {
  cleanup()
  update.mockReset()
})
describe("PWA update activity protection", () => {
  it("disables updating during write transfers and restores it after completion", async () => {
    const client = new QueryClient()
    const endWrite = beginWrite()
    render(<PwaStatus />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    const button = screen.getByRole("button", {
      name: "更新",
    }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await userEvent.click(button)
    expect(update).not.toHaveBeenCalled()
    act(() => endWrite())
    expect(button.disabled).toBe(false)
    await userEvent.click(button)
    expect(update).toHaveBeenCalledTimes(1)
    client.clear()
  })
})
