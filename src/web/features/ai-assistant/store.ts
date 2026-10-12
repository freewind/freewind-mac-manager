import { create } from "zustand"

/**
 * AI 助手浮层的「跨组件共享的本地状态」集中放这里（Zustand）：
 * 入口按钮与浮层是两棵子树，浮层开关与预填上下文只能共享。
 * 会话标识跨浮层开关保留，保证重新打开后续接同一会话。
 */
type AiAssistantLocalState = {
  open: boolean
  /** 打开浮层时预填到输入框的上下文，消费后清空。 */
  initialContext: string | null
  /** 后端会话标识；未新建会话前为 null。 */
  sessionId: string | null

  openWith: (context?: string) => void
  close: () => void
  setSessionId: (sessionId: string | null) => void
  consumeInitialContext: () => void
}

export const useAiAssistantLocalStore = create<AiAssistantLocalState>(
  (set) => ({
    open: false,
    initialContext: null,
    sessionId: null,

    openWith: (context) => set({ open: true, initialContext: context ?? null }),

    close: () => set({ open: false }),

    setSessionId: (sessionId) => set({ sessionId }),

    consumeInitialContext: () => set({ initialContext: null }),
  })
)
