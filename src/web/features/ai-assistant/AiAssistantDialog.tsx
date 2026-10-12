import { AgentChat } from "@web/components/agent-elements/agent-chat"
import {
  InputBar,
  type InputBarProps,
} from "@web/components/agent-elements/input-bar"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@web/components/ui/sheet"
import { Skeleton } from "@web/components/ui/skeleton"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { ArrowRight, Plus } from "lucide-react"
import { useEffect } from "react"
import { AiAssistantToolCard } from "./AiAssistantToolCard"
import { useAiAssistantSettings } from "./queries"
import { useAiAssistantLocalStore } from "./store"
import { AI_ASSISTANT_TOOL_NAME, useStreamChat } from "./use-stream-chat"

/** 工具卡片映射必须在模块级保持稳定，否则每次渲染都会重建组件树。 */
const TOOL_RENDERERS = { [AI_ASSISTANT_TOOL_NAME]: AiAssistantToolCard }

/**
 * 输入框插槽：浮层带着上下文打开时，把上下文填进输入框一次。
 * 插槽组件必须是模块级定义，否则每次渲染换新身份会让输入框重挂载。
 */
const PrefilledInputBar = (slotProps: Record<string, unknown>) => {
  const initialContext = useAiAssistantLocalStore(
    (state) => state.initialContext
  )
  const consumeInitialContext = useAiAssistantLocalStore(
    (state) => state.consumeInitialContext
  )
  const onChange = slotProps.onChange as ((value: string) => void) | undefined

  useEffect(() => {
    if (!initialContext || !onChange) return
    consumeInitialContext()
    onChange(initialContext)
  }, [initialContext, onChange, consumeInitialContext])

  return <InputBar {...(slotProps as InputBarProps)} />
}

type AiAssistantDialogProps = {
  /** 「去设置选模型」的去处；由 App 提供，避免在浮层里重复实现导航。 */
  onOpenModelSettings?: () => void
}

export const AiAssistantDialog = (props: AiAssistantDialogProps) => {
  const open = useAiAssistantLocalStore((state) => state.open)
  const close = useAiAssistantLocalStore((state) => state.close)
  const sessionId = useAiAssistantLocalStore((state) => state.sessionId)
  const setSessionId = useAiAssistantLocalStore((state) => state.setSessionId)

  useHistoryOverlay(open, close)

  const settings = useAiAssistantSettings(open)

  const chat = useStreamChat({ sessionId, onSessionId: setSessionId })
  // 正在进行时不允许新建：否则正在跑的答复找不到归宿。
  const chatRunning = chat.status === "submitted" || chat.status === "streaming"

  const configured = Boolean(
    settings.data?.settings.providerId && settings.data?.settings.modelId
  )

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 pb-[env(safe-area-inset-bottom)] sm:max-w-xl"
      >
        <SheetHeader className="gap-1 border-b p-4">
          <SheetTitle>AI 助手</SheetTitle>
          <SheetDescription>
            助手可以查看和操作本机功能。危险动作会先说明目标与影响。
          </SheetDescription>
          {/* 业务操作放在标题区下方的动作行，不动官方 Sheet 源码。 */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={chatRunning}
              onClick={() => chat.reset()}
            >
              <Plus aria-hidden="true" />
              新建对话
            </Button>
            {chatRunning ? (
              <span className="text-xs text-muted-foreground">
                正在回答，可先中止再新建
              </span>
            ) : null}
          </div>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          {settings.isError ? (
            <div className="p-4">
              <Alert variant="destructive" role="alert">
                <AlertTitle>读取助手设置失败</AlertTitle>
                <AlertDescription>
                  无法确认助手配置，请稍后重新打开浮层核实。
                </AlertDescription>
              </Alert>
            </div>
          ) : settings.isPending ? (
            <div className="flex flex-col gap-2 p-4">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-6 w-1/2" />
            </div>
          ) : !configured ? (
            <div className="p-4">
              <Alert role="status">
                <AlertTitle>助手还没有选择模型</AlertTitle>
                <AlertDescription className="flex flex-col gap-3">
                  <span>请先去设置选择 AI 助手模型，再回来对话。</span>
                  <Button
                    variant="outline"
                    className="min-h-11 w-fit"
                    onClick={() => {
                      close()
                      props.onOpenModelSettings?.()
                    }}
                  >
                    <ArrowRight aria-hidden="true" />
                    去设置模型
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          ) : (
            <>
              {chat.errorStatus === 404 ? (
                <div className="p-4">
                  <Alert variant="destructive" role="alert">
                    <AlertTitle>会话已过期</AlertTitle>
                    <AlertDescription>
                      服务重启或会话被回收后，旧会话无法续接。用上面的
                      「新建对话」重新开始：之前那条输入不会自动重发。
                    </AlertDescription>
                  </Alert>
                </div>
              ) : null}
              <AgentChat
                className="min-h-0 flex-1"
                messages={chat.messages}
                status={chat.status}
                error={chat.error}
                onSend={(message) => void chat.send(message)}
                onStop={chat.stop}
                toolRenderers={TOOL_RENDERERS}
                slots={{ InputBar: PrefilledInputBar }}
                emptyStatePosition="center"
                showCopyToolbar={false}
              />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
