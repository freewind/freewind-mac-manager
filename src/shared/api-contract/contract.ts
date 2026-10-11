import { API_BASE } from "@shared/api-path"
import { c } from "./init"
import { clashVergeRoutes } from "./routes/clash-verge"
import { dashboardRoutes } from "./routes/dashboard"
import { diskGrowthRoutes } from "./routes/disk-growth"
import { dockerRoutes } from "./routes/docker"
import { filesRoutes } from "./routes/files"
import { frpRoutes } from "./routes/frp"
import { healthRoutes } from "./routes/health"
import { piRoutes } from "./routes/pi"
import { portsRoutes } from "./routes/ports"
import { processesRoutes } from "./routes/processes"
import { systemServicesRoutes } from "./routes/system-services"
import { tasksRoutes } from "./routes/tasks"
import { trafficRoutes } from "./routes/traffic"

/** 按域拆到 routes/ 下，这里只做汇总，避免单文件越写越大。 */
export const contract = c.router(
  {
    ...healthRoutes,
    ...clashVergeRoutes,
    ...diskGrowthRoutes,
    ...dockerRoutes,
    ...trafficRoutes,
    ...dashboardRoutes,
    ...portsRoutes,
    ...filesRoutes,
    ...processesRoutes,
    ...systemServicesRoutes,
    ...frpRoutes,
    ...tasksRoutes,
    ...piRoutes,
  },
  { pathPrefix: API_BASE }
)
