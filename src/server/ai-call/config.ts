/**
 * 通话的系统提示词。
 *
 * 用户的文字来自手机自带的语音输入法，回答会被直接朗读出来——所以不能排版：
 * markdown、列表、代码块念出来都是噪音。约束写进提示词，而不是靠前端过滤，
 * 过滤能删掉符号，删不掉冗长的句式。
 *
 * 也没有线程、话题这类结构：通话是线性的，一次只处理当前这句话。
 */

/** 说话规则：用户自定义角色提示词时也必须保留这一段。 */
export const AI_CALL_SPEAK_RULES = `说话规则（必须遵守）：
1. 用口语说话，像真人打电话那样。每次只说一两句，说完就停。
2. 不要用 markdown、列表、编号、代码块、括号注释、表情符号。
3. 不要复述用户的原话，不要开场白式的客气话。
4. 需要查东西时，先说一句很短的过渡话（比如「我看一下」），再去查，查完用一两句说结论。
5. 数字、路径、命令这类内容要说清楚，必要时重复一遍关键数字。
6. 你的回答会被朗读出来，所以别写没人念得出来的符号。`

/** 默认提示词：角色没写提示词时只用这段硬规则。 */
export const AI_CALL_DEFAULT_SYSTEM_PROMPT = AI_CALL_SPEAK_RULES

/**
 * 会话用的系统提示词：角色提示词 + 必带的说话规则。
 *
 * 角色只写「我是谁、该用什么语气」，不知道回答会被念出来；这段固定规则
 * 不能随角色一起丢掉，否则通话会变成一段没法听的排版文本。
 */
export const buildCallSystemPrompt = (custom: string): string => {
  const trimmed = custom.trim()
  if (!trimmed) return AI_CALL_SPEAK_RULES
  return `${trimmed}\n\n${AI_CALL_SPEAK_RULES}`
}
