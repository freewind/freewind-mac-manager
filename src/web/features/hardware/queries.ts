import { fetchHardwareOverview } from "@shared/client-api"
import { useQuery } from "@tanstack/react-query"

export const hardwareKeys = {
  all: ["hardware"] as const,
  overview: ["hardware", "overview"] as const,
}

export const useHardwareOverview = () =>
  useQuery({
    queryKey: hardwareKeys.overview,
    queryFn: fetchHardwareOverview,
    staleTime: 300_000,
  })
