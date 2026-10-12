import type { PiBenchmarkResult } from "@shared/api-contract"
import {
  fetchPiBenchmarks,
  fetchPiModelGroups,
  fetchPiModels,
} from "@shared/client-api"
import { useQuery } from "@tanstack/react-query"

export const piKeys = {
  all: ["pi"] as const,
  models: () => [...piKeys.all, "models"] as const,
  modelGroups: () => [...piKeys.all, "model-groups"] as const,
  benchmarks: () => [...piKeys.all, "benchmarks"] as const,
}

/** 单次测速的服务端上限 60 秒加 5 秒结算宽限，与 server/pi/benchmark.ts 一致。 */
export const BENCHMARK_RUNNING_LIMIT_MS = 65_000

/**
 * 永久停在 running 的记录会让测速历史每秒轮询不停：
 * 超过服务端上限仍是 running 时，服务端下次读取就会返回 unknown，
 * 因此客户端以此判据停止轮询，由页面按「结果未知」展示，不谎报完成。
 */
export const benchmarkRunningExpired = (
  item: PiBenchmarkResult,
  now: number
): boolean =>
  item.status === "running" && now - item.startedAt > BENCHMARK_RUNNING_LIMIT_MS

export const usePiModels = () =>
  useQuery({
    queryKey: piKeys.models(),
    queryFn: fetchPiModels,
    retry: false,
  })

export const usePiModelGroups = () =>
  useQuery({
    queryKey: piKeys.modelGroups(),
    queryFn: fetchPiModelGroups,
    retry: false,
  })

export const usePiBenchmarks = (enabled: boolean) =>
  useQuery({
    queryKey: piKeys.benchmarks(),
    queryFn: ({ signal }) => fetchPiBenchmarks(signal),
    enabled,
    retry: false,
    refetchInterval: (query) => {
      const running = (query.state.data?.benchmarks ?? []).filter(
        (item) => item.status === "running"
      )
      if (running.length === 0) return false
      // 所有 running 记录都已超过服务端上限：服务端下次读取会返回 unknown，
      // 客户端在这里停住，不再每秒重试；页面按「结果未知」展示即可。
      return running.every((item) => benchmarkRunningExpired(item, Date.now()))
        ? false
        : 1000
    },
  })
