import type { ReactNode } from "react"

/**
 * 搜索关键词高亮：把文本中与关键词相同的片段用 <mark> 包起来。
 * 匹配不区分大小写，渲染保留原文大小写；关键词为空时原样输出。
 */
export const HighlightText = (props: { text: string; keyword: string }) => {
  const keyword = props.keyword.trim()
  if (keyword === "") return <>{props.text}</>
  const haystack = props.text.toLowerCase()
  const needle = keyword.toLowerCase()
  const nodes: ReactNode[] = []
  let cursor = 0
  while (cursor < props.text.length) {
    const at = haystack.indexOf(needle, cursor)
    if (at < 0) {
      nodes.push(props.text.slice(cursor))
      break
    }
    if (at > cursor) nodes.push(props.text.slice(cursor, at))
    // key 用命中位置：同一段文字里多次命中时位置唯一，重渲染也不抖动。
    nodes.push(
      <mark
        key={at}
        className="rounded-sm bg-yellow-200/80 text-inherit dark:bg-yellow-400/25"
      >
        {props.text.slice(at, at + keyword.length)}
      </mark>
    )
    cursor = at + keyword.length
  }
  return <>{nodes}</>
}
