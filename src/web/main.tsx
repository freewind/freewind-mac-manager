import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { rootRoute } from "@web/App"
import { PwaStatus } from "@web/components/PwaStatus"
import { Toaster } from "@web/components/ui/sonner"
import { TooltipProvider } from "@web/components/ui/tooltip"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@web/index.css"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      staleTime: 1000,
    },
    mutations: {
      retry: false,
      networkMode: "always",
    },
  },
})

// 路由树只有根路由：URL 状态（?feature= 等）由 router 管理，页面分发仍在 App 内。
const router = createRouter({ routeTree: rootRoute })

const Root = () => (
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <PwaStatus />
        <Toaster position="bottom-right" richColors />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>
)

const container = document.getElementById("root")
if (!container) {
  throw new Error("[computer-manager] 找不到 #root 挂载点")
}

createRoot(container).render(<Root />)
