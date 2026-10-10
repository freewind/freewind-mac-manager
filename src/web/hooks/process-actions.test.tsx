// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { portKeys } from "@web/features/ports/queries"
import { usePorts } from "@web/features/ports/usePorts"
import { trafficKeys } from "@web/features/traffic/queries"
import { REALTIME_SNAPSHOT_ID } from "@web/features/traffic/store"
import { useTraffic } from "@web/features/traffic/useTraffic"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { killPorts, killTraffic } = vi.hoisted(() => ({
  killPorts: vi.fn(),
  killTraffic: vi.fn(),
}))
vi.mock("@shared/client-api", async (original) => ({
  ...(await original<typeof import("@shared/client-api")>()),
  killPortProcesses: killPorts,
  killTrafficProcesses: killTraffic,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const response = { results: [{ pid: 123, succeeded: true, message: "已结束" }] }
const deferred = () => {
  let resolve: (value: typeof response) => void = () => {}
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<typeof response>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
const mount = <T,>(hook: () => T) => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { enabled: false, retry: false },
      mutations: { retry: false },
    },
  })
  client.setQueryData(portKeys.bindings, [])
  client.setQueryData(trafficKeys.snapshots, [])
  client.setQueryData(trafficKeys.groups([REALTIME_SNAPSHOT_ID]), [])
  return {
    client,
    ...renderHook(hook, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }),
  }
}
beforeEach(() => {
  killPorts.mockReset()
  killTraffic.mockReset()
})
afterEach(cleanup)

describe("process action guards", () => {
  it("blocks repeated port termination until completion", async () => {
    const action = deferred()
    killPorts.mockReturnValueOnce(action.promise)
    const { result, client } = mount(usePorts)
    let completed: Promise<boolean> = Promise.resolve(false)
    let duplicate: Promise<boolean> = Promise.resolve(true)
    act(() => {
      completed = result.current.terminate(3000, [123])
      duplicate = result.current.terminate(4000, [123])
    })
    expect(await duplicate).toBe(false)
    await waitFor(() => expect(result.current.killBusy).toBe(true))
    expect(killPorts).toHaveBeenCalledTimes(1)
    await act(async () => action.resolve(response))
    expect(await completed).toBe(true)
    await waitFor(() => expect(result.current.killBusy).toBe(false))
    client.clear()
  })
  it("restores traffic termination after failure and returns a rejected result", async () => {
    const action = deferred()
    killTraffic.mockReturnValueOnce(action.promise)
    const { result, client } = mount(useTraffic)
    let completed: Promise<boolean> = Promise.resolve(true)
    act(() => {
      completed = result.current.terminate("node", [123])
      void result.current.terminate("node", [123])
    })
    await waitFor(() => expect(result.current.killBusy).toBe(true))
    await act(async () => action.reject(new Error("请求被拒绝")))
    expect(await completed).toBe(false)
    await waitFor(() => expect(result.current.killBusy).toBe(false))
    killTraffic.mockResolvedValueOnce(response)
    await act(async () => {
      await result.current.terminate("node", [123])
    })
    expect(killTraffic).toHaveBeenCalledTimes(2)
    client.clear()
  })
})
