import { API_BASE } from "@shared/api-path"
import { c } from "./init"
import { diskGrowthRoutes } from "./routes/disk-growth"
import { healthRoutes } from "./routes/health"

export const contract = c.router(
  {
    ...healthRoutes,
    ...diskGrowthRoutes,
  },
  { pathPrefix: API_BASE }
)
