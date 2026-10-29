import { useCallback, useEffect, useRef, useState } from "react"

/**
 * 把文字念出来，并且能随时打断。
 *
 * 必须按句切分发：Chrome 的 speechSynthesis 喂超长文本会截断甚至卡死，
 * 按句发还能让第一句更快出声。打断用 cancel()，它是同步生效的——这正是
 * 选它而不是自己做音频解码的原因：用户开口的瞬间就该停下。
 */

/** 句末标点：到这里一定可以断句。 */
const HARD_BREAKS = "。！？!?；;\n"
/** 软断句点：攒太长又不到句末时，退一步在逗号处先念一段。 */
const SOFT_BREAKS = "，,、"
/** 缓冲超过这个长度才允许在逗号处断句。 */
const SOFT_BREAK_MIN_CHARS = 40

/**
 * 从缓冲里切出可以立刻念的句子。
 *
 * 返回 [要念的片段, 剩下的缓冲]。流式增量是一个字一个字来的，所以这里
 * 只切完整的句子，剩下的继续等——半个字念出去就是结巴。
 */
const takeSentences = (buffer: string): [string[], string] => {
  const sentences: string[] = []
  let rest = buffer
  for (;;) {
    let cut = -1
    for (let index = 0; index < rest.length; index += 1) {
      if (HARD_BREAKS.includes(rest[index])) {
        cut = index + 1
        break
      }
    }
    if (cut < 0 && rest.length >= SOFT_BREAK_MIN_CHARS) {
      for (let index = rest.length - 1; index >= 0; index -= 1) {
        if (SOFT_BREAKS.includes(rest[index])) {
          cut = index + 1
          break
        }
      }
    }
    if (cut < 0) break
    const sentence = rest.slice(0, cut)
    rest = rest.slice(cut)
    if (sentence.trim()) sentences.push(sentence)
  }
  return [sentences, rest]
}

/** 念出来时不要带上排版符号：模型偶尔漏出 markdown，念出来是噪音。 */
const speakable = (text: string): string =>
  text
    .replace(/[*_`#>~-]{1,}/g, " ")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()

/**
 * 待念内容与待念句子。
 *
 * 两者都不参与渲染（渲染只关心 speaking），所以放 ref 而不是 state：
 * 放 state 会让每个 delta 都触发一次重渲染。
 */
type SpeechBuffer = {
  pending: string
  queue: string[]
}

export type SpeechOutput = {
  /** 追加一段要念的文字；攒够一句就开口。 */
  enqueue: (text: string) => void
  /** 把缓冲里剩下的念完（一次回答结束时调用）。 */
  flush: () => void
  /** 丢弃待念内容并立刻停声；用户打断时调用。 */
  cancel: () => void
  /** 是否正在出声。界面据此显示「正在说话」。 */
  speaking: boolean
}

export const useSpeechOutput = (options: {
  /** 一句话全部念完、且队列已空：上层据此把状态从「说话」切回「听」。 */
  onSettled?: () => void
}): SpeechOutput => {
  const bufferRef = useRef<SpeechBuffer | null>(null)
  if (bufferRef.current === null) bufferRef.current = { pending: "", queue: [] }

  const pumpRef = useRef<(() => void) | null>(null)
  const settledRef = useRef(options.onSettled)
  settledRef.current = options.onSettled
  const [speaking, setSpeaking] = useState(false)

  /**
   * 念下一句。
   *
   * 用 ref 持有自身：utterance 的 onend 要递归调用它，而 useCallback
   * 里直接引用自己会形成循环依赖。
   */
  const pump = useCallback(() => {
    if (typeof window === "undefined") return
    const next = bufferRef.current?.queue.shift()
    if (next === undefined) {
      setSpeaking(false)
      settledRef.current?.()
      return
    }
    const utterance = new SpeechSynthesisUtterance(next)
    utterance.lang = "zh-CN"
    utterance.rate = 1.05
    // 出错也继续念下一句：一句坏掉不该把整段回答吞掉。
    utterance.onend = () => pumpRef.current?.()
    utterance.onerror = () => pumpRef.current?.()
    setSpeaking(true)
    window.speechSynthesis.speak(utterance)
  }, [])
  pumpRef.current = pump

  const flush = useCallback(() => {
    const current = bufferRef.current
    if (!current) return
    const rest = speakable(current.pending)
    current.pending = ""
    if (rest) current.queue.push(rest)
    if (current.queue.length > 0) pumpRef.current?.()
  }, [])

  const enqueue = useCallback((text: string) => {
    const current = bufferRef.current
    if (!current || typeof window === "undefined") return
    const [sentences, rest] = takeSentences(current.pending + text)
    current.pending = rest
    for (const sentence of sentences) {
      const clean = speakable(sentence)
      if (clean) current.queue.push(clean)
    }
    if (current.queue.length > 0) pumpRef.current?.()
  }, [])

  const cancel = useCallback(() => {
    const current = bufferRef.current
    if (current) {
      current.pending = ""
      current.queue = []
    }
    if (typeof window !== "undefined") window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [])

  // 离开页面时必须停声：否则切走之后声音还在响，且没有入口能停。
  useEffect(
    () => () => {
      if (typeof window !== "undefined") window.speechSynthesis.cancel()
    },
    []
  )

  return { enqueue, flush, cancel, speaking }
}
