// @vitest-environment jsdom
import type { SystemService } from "@shared/api-contract"
import { ApiRequestError } from "@shared/client-api"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { clearPendingRequests } from "@web/features/tasks/pending-requests"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { systemServiceKeys } from "./queries"
import { SystemServicesPage } from "./SystemServicesPage/SystemServicesPage"

const { stopService } = vi.hoisted(() => ({ stopService: vi.fn() }))
vi.mock("@shared/client-api", async (original) => ({
  ...(await original<typeof import("@shared/client-api")>()),
  stopSystemService: stopService,
}))
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
vi.mock("@web/hooks/use-history-overlay", () => ({
  useHistoryOverlay: () => {},
}))
const service: SystemService = {
  label: "test.service",
  domain: "user",
  filePath: "/tmp/test.plist",
  exists: true,
  loaded: true,
  disabled: false,
  state: "running",
  pid: 123,
  lastExitCode: null,
  startedAt: null,
  program: "/tmp/test",
  args: [],
  runAtLoad: true,
  keepAlive: false,
  startInterval: null,
  workingDirectory: null,
  stdoutPath: null,
  stderrPath: null,
  environment: {},
  processType: null,
  throttleInterval: null,
  requiresRoot: false,
  plist: "<plist />",
}
beforeEach(() => {
  clearPendingRequests()
  stopService.mockReset()
})
afterEach(() => {
  cleanup()
  clearPendingRequests()
})

describe("system service confirmation", () => {
  it("keeps the target visible during execution, preserves it on rejection and closes on success", async () => {
    let reject: (error: Error) => void = () => {}
    stopService.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail
      })
    )
    const client = new QueryClient({
      defaultOptions: {
        queries: { enabled: false, retry: false },
        mutations: { retry: false },
      },
    })
    client.setQueryData(systemServiceKeys.list, {
      services: [service],
      skipped: [],
    })
    render(<SystemServicesPage />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    await userEvent.click(screen.getByRole("button", { name: "停止" }))
    const dialog = screen.getByRole("alertdialog")
    expect(dialog.textContent).toContain("test.service")
    await userEvent.click(within(dialog).getByRole("button", { name: "停止" }))
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "test.service"
    )
    const cancel = screen.getByRole("button", {
      name: "取消",
    }) as HTMLButtonElement
    expect(cancel.disabled).toBe(true)
    expect(stopService).toHaveBeenCalledTimes(1)
    await act(async () => reject(new ApiRequestError("权限不足", 403)))
    await waitFor(() =>
      expect(
        (
          within(dialog).getByRole("button", {
            name: "停止",
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    )
    await userEvent.click(cancel)
    expect(screen.queryByRole("alertdialog")).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "停止" }))
    stopService.mockResolvedValueOnce({
      kind: "completed",
      body: { message: "已停止" },
    })
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "停止",
      })
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(stopService).toHaveBeenCalledTimes(2)
    client.clear()
  })
})
