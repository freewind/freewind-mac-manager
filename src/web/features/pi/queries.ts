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
    queryFn: fetchPiBenchmarks,
    enabled,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.benchmarks.some((item) => item.status === "running")
        ? 1000
        : false,
  })
