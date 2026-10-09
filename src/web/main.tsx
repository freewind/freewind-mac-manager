import { RefreshIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { App } from "@web/App"
import { Button } from "@web/components/ui/button"
import { Toaster } from "@web/components/ui/sonner"
import { TooltipProvider } from "@web/components/ui/tooltip"
import { usePwaStatus } from "@web/hooks/use-pwa-status"
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
    },
  },
})

const PwaStatus = () => {
  const { online, updateAvailable, applyUpdate } = usePwaStatus()
  return (
    <>
      {!online ? (
        <div
          role="status"
          className="fixed right-3 bottom-3 z-50 rounded-md border bg-background px-3 py-2 text-xs shadow-md"
        >
          当前离线，系统数据与写操作已暂停
        </div>
      ) : null}
      {updateAvailable ? (
        <div className="fixed right-3 bottom-16 z-50 flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs shadow-md">
          <span>新版本已就绪</span>
          <Button size="sm" variant="outline" onClick={applyUpdate}>
            <HugeiconsIcon icon={RefreshIcon} />
            更新
          </Button>
        </div>
      ) : null}
    </>
  )
}

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
