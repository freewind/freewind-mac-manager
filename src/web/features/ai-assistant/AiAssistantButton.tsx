import { AiBrain01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@web/components/ui/button"
import { useAiAssistantLocalStore } from "./store"

type AiAssistantButtonProps = {
  /** 打开时预填到输入框的上下文（功能页按需传入）。 */
  context?: string
}

/** 顶栏的 AI 助手入口；浮层本身由 App 全局渲染一份。 */
export const AiAssistantButton = (props: AiAssistantButtonProps) => {
  const openWith = useAiAssistantLocalStore((state) => state.openWith)

  return (
    <Button
      variant="ghost"
      size="icon"
      className="min-h-11 min-w-11"
      aria-label="打开 AI 助手"
      title="AI 助手"
      onClick={() => openWith(props.context)}
    >
      <HugeiconsIcon icon={AiBrain01Icon} aria-hidden="true" />
    </Button>
  )
}
