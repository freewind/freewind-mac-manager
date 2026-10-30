import { Type } from "@earendil-works/pi-ai"
import { defineTool } from "@earendil-works/pi-coding-agent"

/**
 * 通话的语音输出工具。
 *
 * 打电话时用户只能听到这个工具的内容：正文既不显示也不朗读，落库的也是它。
 * 这样「要不要出声、要不要打断正在说的话」由模型判断，前端不再拿音量规则
 * 去猜——噪声、别人说话、误识别都可以由模型直接忽略。
 */

export const AI_CALL_SPEAK_TOOL = "speak"

/** 每条通话已经说出去的内容：落库与界面都只认它，不认模型正文。 */
const spoken = new Map<string, string[]>()

export const getSpokenText = (sessionId: string): string =>
  (spoken.get(sessionId) ?? []).join("\n")

export const clearSpokenText = (sessionId: string): void => {
  spoken.delete(sessionId)
}

export const createSpeakTool = (sessionId: string) =>
  defineTool({
    name: AI_CALL_SPEAK_TOOL,
    label: "说出来",
    description:
      "把要说给用户听的内容念出来。电话里用户只能听到这个工具的内容，普通正文既不显示也不朗读。用户真的在跟你说话、需要回应时用它；想分几句说可以多次调用。收到没有意义的内容（噪声、误识别、旁边的人说话、纯口头语）时不要调用，保持安静即可。",
    parameters: Type.Object({
      text: Type.String({
        description: "要念给用户听的完整句子，口语化，不要 markdown",
      }),
      interrupt: Type.Optional(
        Type.Boolean({
          description:
            "是否立刻打断正在念的内容。用户确实在提问、需要马上回应时传 true；只是把当前回答接着说下去时省略",
        })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const text = params.text.trim()
      if (!text) {
        return {
          content: [{ type: "text" as const, text: "内容为空，没有说出声" }],
          details: {},
          isError: true,
        }
      }
      const list = spoken.get(sessionId) ?? []
      list.push(text)
      spoken.set(sessionId, list)
      return {
        content: [{ type: "text" as const, text: "已经念给用户听了" }],
        details: {},
      }
    },
  })
