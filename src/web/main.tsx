import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "@web/App"
import { TooltipProvider } from "@web/components/ui/tooltip"
import "@web/index.css"

const container = document.getElementById("root")
if (!container) {
  throw new Error("[mac-manager] 找不到 #root 挂载点")
}

createRoot(container).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>
)
