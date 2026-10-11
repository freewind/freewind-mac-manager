import { fetchPiModels } from "@shared/client-api"
import { useQuery } from "@tanstack/react-query"

export const piKeys = {
  all: ["pi"] as const,
  models: () => [...piKeys.all, "models"] as const,
}

export const usePiModels = () =>
  useQuery({
    queryKey: piKeys.models(),
    queryFn: fetchPiModels,
    retry: false,
  })
