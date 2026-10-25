import { type ReactNode, useRef } from "react"

/** 一段文字的着色分类：只区分 YAML 里最常见的几种。 */
type SegmentKind =
  | "plain"
  | "comment"
  | "key"
  | "dash"
  | "string"
  | "number"
  | "literal"

const SEGMENT_CLASS: Record<SegmentKind, string> = {
  plain: "",
  comment: "text-muted-foreground italic",
  key: "text-sky-700 dark:text-sky-300",
  dash: "text-muted-foreground",
  string: "text-emerald-700 dark:text-emerald-300",
  number: "text-amber-700 dark:text-amber-300",
  literal: "text-violet-700 dark:text-violet-300",
}

/** 数字与 YAML 字面量：值不带引号时按它们着色。 */
const NUMBER_PATTERN = /^-?\d+(?:\.\d+)?$/
const LITERAL_PATTERN = /^(?:true|false|null|yes|no|on|off|~)$/i

/** 找到行尾注释的起点：引号里的 # 不算注释。 */
const findCommentStart = (line: string): number => {
  let inSingle = false
  let inDouble = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"' && !inSingle) {
      inDouble = !inDouble
    } else if (char === "'" && !inDouble) {
      inSingle = !inSingle
    } else if (
      char === "#" &&
      !inSingle &&
      !inDouble &&
      (index === 0 || /\s/.test(line[index - 1] ?? ""))
    ) {
      return index
    }
  }
  return -1
}

const valueKind = (value: string): SegmentKind => {
  if (value === "") {
    return "plain"
  }
  if (NUMBER_PATTERN.test(value)) {
    return "number"
  }
  if (LITERAL_PATTERN.test(value)) {
    return "literal"
  }
  return "string"
}

/** 把一行 YAML 拆成若干着色片段；换行由调用方补回。 */
const segmentLine = (line: string): { text: string; kind: SegmentKind }[] => {
  if (line.trim() === "") {
    return [{ text: line, kind: "plain" }]
  }
  if (line.trimStart().startsWith("#")) {
    return [{ text: line, kind: "comment" }]
  }

  const commentStart = findCommentStart(line)
  const code = commentStart === -1 ? line : line.slice(0, commentStart)
  const comment = commentStart === -1 ? "" : line.slice(commentStart)

  const segments: { text: string; kind: SegmentKind }[] = []
  const indent = code.length - code.trimStart().length
  if (indent > 0) {
    segments.push({ text: code.slice(0, indent), kind: "plain" })
  }
  let rest = code.slice(indent)
  if (rest.startsWith("- ")) {
    segments.push({ text: "- ", kind: "dash" })
    rest = rest.slice(2)
  }

  const colonAt = rest.indexOf(":")
  // 键值行才分两段；纯值（列表项、多行字符串续行）整体当值处理。
  const isKeyValue =
    colonAt > 0 &&
    (colonAt === rest.length - 1 || /\s/.test(rest[colonAt + 1] ?? "")) &&
    !rest.startsWith('"') &&
    !rest.startsWith("'")
  if (isKeyValue) {
    segments.push({ text: rest.slice(0, colonAt), kind: "key" })
    segments.push({ text: ":", kind: "plain" })
    const afterColon = rest.slice(colonAt + 1)
    const space = afterColon.length - afterColon.trimStart().length
    if (space > 0) {
      segments.push({ text: afterColon.slice(0, space), kind: "plain" })
    }
    const value = afterColon.trimStart()
    if (value !== "") {
      segments.push({ text: value, kind: valueKind(value) })
    }
  } else if (rest !== "") {
    segments.push({ text: rest, kind: valueKind(rest) })
  }

  if (comment !== "") {
    segments.push({ text: comment, kind: "comment" })
  }
  return segments
}

const highlight = (source: string): ReactNode[] => {
  const nodes: ReactNode[] = []
  // 用「已走过的字符数 + 分类」做 key：同一行可能有多段同样文字，但位置唯一。
  let offset = 0
  for (const line of source.split("\n")) {
    for (const segment of segmentLine(line)) {
      const className = SEGMENT_CLASS[segment.kind]
      nodes.push(
        className === "" ? (
          segment.text
        ) : (
          <span key={`${segment.kind}-${offset}`} className={className}>
            {segment.text}
          </span>
        )
      )
      offset += segment.text.length
    }
    nodes.push("\n")
    offset += 1
  }
  return nodes
}

/**
 * 可编辑的 YAML：底层是彩色只读文本，上面盖一个文字透明的 textarea。
 * 两者字体、行高、内边距、换行方式完全一致，所以光标正好落在字上；
 * 滚动时把底层一起挪，避免错位。
 */
export const EditableYaml = (props: {
  value: string
  ariaLabel: string
  onChange: (next: string) => void
}) => {
  const backdropRef = useRef<HTMLDivElement>(null)
  return (
    <div className="relative min-h-[320px] w-full overflow-hidden rounded-md border">
      <div
        ref={backdropRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap"
      >
        {highlight(props.value)}
      </div>
      <textarea
        value={props.value}
        aria-label={props.ariaLabel}
        spellCheck={false}
        className="relative min-h-[320px] w-full resize-y bg-transparent p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap text-transparent caret-foreground outline-none selection:bg-primary/25"
        onChange={(event) => props.onChange(event.target.value)}
        onScroll={(event) => {
          const backdrop = backdropRef.current
          if (backdrop !== null) {
            backdrop.scrollTop = event.currentTarget.scrollTop
          }
        }}
      />
    </div>
  )
}
