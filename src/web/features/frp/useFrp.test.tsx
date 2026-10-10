// @vitest-environment jsdom
import {
  type FrpConfig,
  type FrpProbe,
  TASK_KINDS,
  type TaskRecord,
} from "@shared/api-contract"
import { configSignature } from "@shared/frp-format"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { runTaskCompletion } from "@web/features/tasks/completion"
import { taskKeys } from "@web/features/tasks/queries"
import type { ReactNode } from "react"
import { toast } from "sonner"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { frpKeys } from "./queries"
import { useFrpLocalStore } from "./store"
import { useFrp } from "./useFrp"

const { probeApi, saveApi, readApi, taskApi } = vi.hoisted(() => ({
  probeApi: vi.fn(),
  saveApi: vi.fn(),
  readApi: vi.fn(),
  taskApi: vi.fn(),
}))
vi.mock("@shared/client-api", async (original) => ({
  ...(await original<typeof import("@shared/client-api")>()),
  probeFrpProxy: probeApi,
  saveFrpConfig: saveApi,
  fetchFrpConfig: readApi,
  fetchTask: taskApi,
}))
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
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
  vi.clearAllMocks()
  probeApi.mockReset()
  saveApi.mockReset()
  readApi.mockReset()
  taskApi.mockReset()
  localStorage.clear()
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

const savedTask = (
  status: "done" | "failed" | "unknown",
  id = "frp-save"
): TaskRecord => ({
  id,
  kind: TASK_KINDS.frpConfigSave,
  requestId: null,
  target: "frp:config",
  status,
  progress: null,
  message: null,
  error: status === "done" ? null : "未完成",
  result: status === "done" ? { message: "已写入配置" } : null,
  startedAt: 1000,
  finishedAt: 2000,
  updatedAt: 2000,
})
describe("FRP save and refresh feedback", () => {
  it("marks only the submitted configuration saved on quick completion", async () => {
    saveApi.mockResolvedValue({
      kind: "completed",
      body: { message: "已写入配置" },
    })
    const { result: hook, client } = mount()
    expect(hook.current.dirty).toBe(true)
    act(() => hook.current.save())
    await waitFor(() => expect(hook.current.dirty).toBe(false))
    expect(toast.success).toHaveBeenCalledWith("已写入配置")
    expect(readApi).not.toHaveBeenCalled()
    client.clear()
  })
  it("keeps a draft dirty until an accepted save finishes and is read back", async () => {
    const task = savedTask("done", "accepted-frp")
    saveApi.mockResolvedValue({ kind: "accepted", body: { taskId: task.id } })
    taskApi.mockResolvedValue({
      ...task,
      status: "running",
      result: null,
      finishedAt: null,
    })
    let resolve: (value: FrpConfig) => void = () => {}
    readApi.mockReturnValue(
      new Promise<FrpConfig>((done) => {
        resolve = done
      })
    )
    const { result: hook, client } = mount()
    act(() => hook.current.save())
    await waitFor(() => expect(taskApi).toHaveBeenCalled())
    expect(hook.current.dirty).toBe(true)
    expect(hook.current.saving).toBe(true)
    act(() => client.setQueryData(taskKeys.detail(task.id), task))
    await waitFor(() => expect(readApi).toHaveBeenCalled())
    expect(hook.current.dirty).toBe(true)
    expect(toast.success).not.toHaveBeenCalled()
    await act(async () =>
      resolve({ ...config, savedSignature: configSignature(config) })
    )
    await waitFor(() => expect(hook.current.dirty).toBe(false))
    client.clear()
  })
  it("preserves edits made while a background save was running", async () => {
    readApi.mockResolvedValue({
      ...config,
      savedSignature: configSignature(config),
    })
    const { client } = mount()
    const edited = { ...config, proxies: config.proxies.slice(0, 1) }
    act(() => client.setQueryData(frpKeys.config, edited))
    await act(async () => runTaskCompletion(savedTask("done")))
    expect(client.getQueryData<FrpConfig>(frpKeys.config)?.proxies).toEqual(
      edited.proxies
    )
    expect(client.getQueryData<FrpConfig>(frpKeys.config)?.savedSignature).toBe(
      configSignature(config)
    )
    client.clear()
  })
  it.each(["failed", "unknown"] as const)(
    "does not update saved state after %s",
    async (status) => {
      const { client } = mount()
      await act(async () => runTaskCompletion(savedTask(status)))
      expect(readApi).not.toHaveBeenCalled()
      expect(
        client.getQueryData<FrpConfig>(frpKeys.config)?.savedSignature
      ).toBe("")
      client.clear()
    }
  )
  it("keeps the saved state unverified when reading after completion fails", async () => {
    readApi.mockRejectedValue(new Error("读取不可用"))
    const { client } = mount()
    await act(async () => runTaskCompletion(savedTask("done")))
    expect(client.getQueryData<FrpConfig>(frpKeys.config)?.savedSignature).toBe(
      ""
    )
    expect(toast.error).toHaveBeenCalledWith(
      "保存任务已完成，但读取保存状态失败：读取不可用"
    )
    client.clear()
  })
  it("reports refresh success only after the read finishes", async () => {
    let resolve: (value: FrpConfig) => void = () => {}
    readApi.mockReturnValue(
      new Promise<FrpConfig>((done) => {
        resolve = done
      })
    )
    const { result: hook, client } = mount()
    let refreshing = Promise.resolve()
    act(() => {
      refreshing = hook.current.refresh()
    })
    expect(toast.info).not.toHaveBeenCalled()
    await act(async () => {
      resolve(config)
      await refreshing
    })
    expect(toast.info).toHaveBeenCalledWith("已重新读取 frpc 配置")
    client.clear()
  })
  it("reports refresh failure rather than success", async () => {
    readApi.mockRejectedValue(new Error("读取不可用"))
    const { result: hook, client } = mount()
    await act(async () => hook.current.refresh())
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith("读取失败：读取不可用")
    client.clear()
  })
})
