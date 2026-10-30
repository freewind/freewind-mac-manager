/**
 * 识别文本的清理与去重。
 *
 * 说话时的语气词会被原样写进对话，AI 会当成内容回答，节奏也被打断。
 * 这里只处理明确是口水词的部分：句首语气词、连说的「那个那个」。
 * 句中带指代意义的「那个」不动——删掉会改变句子意思。
 */

/** 句首语气词：反复出现时一并削掉。 */
const LEADING_FILLERS = /^(?:嗯+|啊+|呃+|额+|哦+|噢+|唉+|诶+|欸+|唔+|咳+|哼+)/

/** 连续两次以上的「那个 / 这个 / 就是」才是口水词，单次保留。 */
const DOUBLED_FILLERS = /^(?:(那个|这个|就是)\1+)/

export const cleanTranscript = (input: string): string => {
  let text = input.trim()
  for (;;) {
    const next = text
      .replace(LEADING_FILLERS, "")
      .replace(DOUBLED_FILLERS, "")
      .trim()
    if (next === text) break
    text = next
  }
  return text
}

/** 结束口令：说完它并停顿，就表示这段话说完了。 */
export const END_CUE = "回答"

/** 文本是否以结束口令结尾。 */
export const endsWithCue = (text: string): boolean =>
  text.trimEnd().endsWith(END_CUE)

/** 口令只用于控制发送时机，不进入对话内容。 */
export const stripEndCue = (text: string): string => {
  const trimmed = text.trimEnd()
  if (!trimmed.endsWith(END_CUE)) return text
  return trimmed.slice(0, -END_CUE.length).trim()
}

/**
 * 同一句被切成两段时去掉重复的那段。
 *
 * 断句靠能量判断，换气或拖尾可能把一句话切两次；两段文本往往是包含关系，
 * 只在「新片段占了上一段一半以上」时才判定重复，避免把「好」这种短回答误删。
 */
export const isRepeatedSegment = (previous: string, next: string): boolean => {
  if (!previous || !next) return false
  if (previous === next) return true
  if (next.length < 2) return false
  return previous.endsWith(next) && next.length * 2 >= previous.length
}
