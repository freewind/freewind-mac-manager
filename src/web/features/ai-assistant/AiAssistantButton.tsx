import { Button } from "@web/components/ui/button"
import { Brain } from "lucide-react"
import { useAiAssistantLocalStore } from "./store"

type AiAssistantButtonProps = {
  /**
   * 打开时预填到输入框的上下文（功能页按需传入，由 buildAiAssistantContext 生成）。
   * 传入后只是预填：用户仍要自己检查、编辑并手动发送。
   */
  context?: string
}

/** 顶栏与功能页工具栏共用的 AI 助手入口；浮层本身由 App 全局渲染一份。 */
export const AiAssistantButton = (props: AiAssistantButtonProps) => {
  const openWith = useAiAssistantLocalStore((state) => state.openWith)

  return (
    <Button
      variant="outline"
      className="min-h-11 shrink-0 px-3"
      aria-label="AI 助手"
      title="AI 助手"
      onClick={() => openWith(props.context)}
    >
      <Brain aria-hidden="true" />
      AI
    </Button>
  )
}
