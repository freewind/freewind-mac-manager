import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { App } from "@web/App"
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

const Root = () => (
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <App />
        <PwaStatus />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>
)

const container = document.getElementById("root")
if (!container) {
  throw new Error("[mac-manager] 找不到 #root 挂载点")
}

createRoot(container).render(<Root />)
