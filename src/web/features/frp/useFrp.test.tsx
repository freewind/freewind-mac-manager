// @vitest-environment jsdom
import type { FrpConfig, FrpProbe } from "@shared/api-contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { frpKeys } from "./queries"
import { useFrpLocalStore } from "./store"
import { useFrp } from "./useFrp"

const { probeApi } = vi.hoisted(() => ({ probeApi: vi.fn() }))
vi.mock("@shared/client-api", async (original) => ({
  ...(await original<typeof import("@shared/client-api")>()),
  probeFrpProxy: probeApi,
}))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const config: FrpConfig = {
  server: {
    serverAddr: "example.test",
    serverPort: 7000,
    authMethod: "token",
    authToken: "test",
    configPath: "/tmp/frpc.toml",
    binaryPath: "/tmp/frpc",
    launchdLabel: "test.frpc",
    state: "stopped",
    pid: null,
    startedAt: null,
  },
  proxies: [
    {
      name: "one",
      type: "tcp",
      localIP: "127.0.0.1",
      localPort: 3000,
      remotePort: 3001,
    },
    {
      name: "two",
      type: "tcp",
      localIP: "127.0.0.1",
      localPort: 4000,
      remotePort: 4001,
    },
  ],
  savedSignature: "",
}
const result: FrpProbe = {
  reachable: true,
  latencyMs: 1,
  message: "可达",
  checkedAt: 1000,
}
const deferred = () => {
  let resolve: (value: FrpProbe) => void = () => {}
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<FrpProbe>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
const mount = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, retry: false },
      mutations: { retry: false },
    },
  })
  client.setQueryData(frpKeys.config, config)
  const hook = renderHook(useFrp, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
  return { ...hook, client }
}
beforeEach(() => {
  probeApi.mockReset()
  useFrpLocalStore.setState({ checking: [], probes: {} })
})
afterEach(cleanup)

describe("FRP probe submission", () => {
  it("blocks repeats and individual probes until all concurrent probes settle", async () => {
    const one = deferred()
    const two = deferred()
    probeApi.mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise)
    const { result: hook, client } = mount()
    let running: Promise<void> = Promise.resolve()
    act(() => {
      running = hook.current.probeAll()
      void hook.current.probeAll()
      void hook.current.probe(config.proxies[0])
    })
    await waitFor(() => expect(probeApi).toHaveBeenCalledTimes(2))
    expect(hook.current.probing).toBe(true)
    await act(async () => one.reject(new Error("连接失败")))
    expect(hook.current.probing).toBe(true)
    await act(async () => {
      two.resolve(result)
      await running
    })
    await waitFor(() => expect(hook.current.probing).toBe(false))
    client.clear()
  })

  it("blocks same-proxy repeats and restores availability after errors", async () => {
    const one = deferred()
    probeApi.mockReturnValueOnce(one.promise)
    const { result: hook, client } = mount()
    let running: Promise<void> = Promise.resolve()
    act(() => {
      running = hook.current.probe(config.proxies[0])
      void hook.current.probe(config.proxies[0])
      void hook.current.probeAll()
    })
    await waitFor(() => expect(probeApi).toHaveBeenCalledTimes(1))
    await act(async () => {
      one.reject(new Error("连接失败"))
      await running
    })
    await waitFor(() => expect(hook.current.probing).toBe(false))
    probeApi.mockResolvedValueOnce(result)
    await act(async () => {
      await hook.current.probe(config.proxies[0])
    })
    expect(probeApi).toHaveBeenCalledTimes(2)
    client.clear()
  })
})
