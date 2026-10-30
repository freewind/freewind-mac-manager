import type { ExecutionPersistence } from "@server/ai-assistant/runner"
import { serializeCallSession } from "./session"
import { clearSpokenText, getSpokenText } from "./speak-tool"
import {
  appendCallMessage,
  findCallSessionByRequestId,
  finishCallRun,
  saveCallAnswer,
  saveCallEntries,
  startCallRun,
} from "./store"

/**
 * 通话的执行落库适配层。
 *
 * 执行生命周期完全复用助手的 runner：这里只把写入点接到通话自己的两张表上，
 * 不再实现一套执行、重连与停止逻辑。
 *
 * 落库内容只取 speak 工具说过的话，不取模型正文：用户只听过这些，
 * 回看历史时看到的也必须是一样的东西。
 *
 * 用户消息在开始执行前写入：执行中刷新页面必须能看到自己刚说的话，
 * 而不是等回答出来才一起出现。
 */
export const callPersistence: ExecutionPersistence = {
  hasRequest: (requestId) => findCallSessionByRequestId(requestId) !== null,
  startRun: (sessionId, userMessage, requestId) => {
    startCallRun(sessionId, requestId)
    appendCallMessage({
      sessionId,
      role: "user",
      body: userMessage.text,
    })
  },
  saveAnswer: (sessionId) => {
    const spoken = getSpokenText(sessionId)
    // 没有调用 speak 的一轮不留回答：模型什么都没说，历史里也不该有。
    if (!spoken) return
    saveCallAnswer(sessionId, spoken)
  },
  finishRun: (sessionId, status) => {
    finishCallRun(sessionId, status, getSpokenText(sessionId) || null)
    clearSpokenText(sessionId)
  },
  // 上下文保存失败会让下次继续通话丢掉这次内容，必须如实上报（runner 会转成提示）。
  saveContext: (sessionId) => {
    const entries = serializeCallSession(sessionId)
    if (entries) saveCallEntries(sessionId, entries)
  },
}
