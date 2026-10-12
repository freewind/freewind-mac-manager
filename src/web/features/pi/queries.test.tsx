// @vitest-environment jsdom

import type { PiBenchmarkResult } from "@shared/api-contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  BENCHMARK_RUNNING_LIMIT_MS,
  benchmarkRunningExpired,
  usePiBenchmarks,
} from "./queries"

const api = vi.hoisted(() => ({
  fetchPiBenchmarks: vi.fn(),
  fetchPiModels: vi.fn(),
  fetchPiModelGroups: vi.fn(),
}))

vi.mock(import("@shared/client-api"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchPiBenchmarks: api.fetchPiBenchmarks,
  fetchPiModels: api.fetchPiModels,
  fetchPiModelGroups: api.fetchPiModelGroups,
}))

const benchmark = (
  overrides: Partial<PiBenchmarkResult> = {}
): PiBenchmarkResult => ({
  id: "bench-1",
  requestId: "req-1234567890abcdef",
  providerId: "p1",
  modelId: "m1",
  thinkingLevel: "off",
  configuredMaxTokens: 512,
  status: "running",
  message: "测速中",
  metrics: {
    firstEventMs: null,
    firstTextMs: null,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
    textOutputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    totalTokens: null,
    outputTokensPerSecond: null,
    thinkingTokens: null,
  },
  stopReason: null,
  error: null,
  startedAt: Date.now(),
  finishedAt: null,
  source: "pi-sdk",
  ...overrides,
})

const mount = (enabled = true) =>
  renderHook(() => usePiBenchmarks(enabled), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        {children}
      </QueryClientProvider>
    ),
  })

const sleep = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

afterEach(() => {
  cleanup()
  api.fetchPiBenchmarks.mockReset()
  api.fetchPiModels.mockReset()
  api.fetchPiModelGroups.mockReset()
})

describe("benchmarkRunningExpired", () => {
  it("只有超过服务端上限仍在 running 才算过期", () => {
    const now = 1_700_000_000_000
    expect(
      benchmarkRunningExpired(
        benchmark({ startedAt: now - BENCHMARK_RUNNING_LIMIT_MS - 1 }),
        now
      )
    ).toBe(true)
    expect(
      benchmarkRunningExpired(
        benchmark({ startedAt: now - BENCHMARK_RUNNING_LIMIT_MS + 1 }),
        now
      )
    ).toBe(false)
    // 已结束的记录不再触发轮询，也不该被判成过期
    expect(
      benchmarkRunningExpired(
        benchmark({ status: "done", startedAt: now - 600_000 }),
        now
      )
    ).toBe(false)
  })
})

describe("测速历史轮询", () => {
  it("有正在跑的记录时按 1 秒刷新", async () => {
    api.fetchPiBenchmarks.mockResolvedValue({ benchmarks: [benchmark()] })
    mount()

    await waitFor(() => expect(api.fetchPiBenchmarks).toHaveBeenCalledTimes(1))
    await waitFor(
      () =>
        expect(api.fetchPiBenchmarks.mock.calls.length).toBeGreaterThanOrEqual(
          2
        ),
      { timeout: 3000 }
    )
  })

  it("永久停在 running 的记录超过上限后停止轮询", async () => {
    api.fetchPiBenchmarks.mockResolvedValue({
      benchmarks: [
        benchmark({
          startedAt: Date.now() - BENCHMARK_RUNNING_LIMIT_MS - 1000,
        }),
      ],
    })
    mount()

    await waitFor(() => expect(api.fetchPiBenchmarks).toHaveBeenCalledTimes(1))
    await sleep(1300)
    // 不再每秒重试：服务端下次读取会把它当 unknown
    expect(api.fetchPiBenchmarks).toHaveBeenCalledTimes(1)
  })

  it("没有正在跑的记录时不轮询", async () => {
    api.fetchPiBenchmarks.mockResolvedValue({
      benchmarks: [benchmark({ status: "done", finishedAt: Date.now() })],
    })
    mount()

    await waitFor(() => expect(api.fetchPiBenchmarks).toHaveBeenCalledTimes(1))
    await sleep(1300)
    expect(api.fetchPiBenchmarks).toHaveBeenCalledTimes(1)
  })

  it("把 query 的 signal 透传给读取函数，便于取消", async () => {
    api.fetchPiBenchmarks.mockResolvedValue({ benchmarks: [] })
    mount()

    await waitFor(() => expect(api.fetchPiBenchmarks).toHaveBeenCalledTimes(1))
    expect(api.fetchPiBenchmarks.mock.calls[0][0]).toBeInstanceOf(AbortSignal)
  })

  it("enabled 为 false 时不读取", async () => {
    api.fetchPiBenchmarks.mockResolvedValue({ benchmarks: [] })
    mount(false)

    await sleep(300)
    expect(api.fetchPiBenchmarks).not.toHaveBeenCalled()
  })
})
