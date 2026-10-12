import { useRef } from "react"

type LineTextareaProps = {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  ariaLabel: string
}

/**
 * 带行号的受控 textarea：行号栏与内容区等行高，滚动时同步行号栏；
 * wrap=off + whitespace-pre 让长行在框内横向滚动，不撑破页面布局。
 * monaco-editor 实测后降级（见 MergeFilePanel 顶部说明）。
 */
export const LineTextarea = ({
  value,
  onChange,
  disabled,
  ariaLabel,
}: LineTextareaProps) => {
  const gutterRef = useRef<HTMLDivElement>(null)
  const lines = value.split("\n")

  // 行号栏不接收滚轮，只跟随内容区滚动，避免两处滚动不同步。
  const syncScroll = (event: React.UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = event.currentTarget.scrollTop
    }
  }

  return (
    <div className="flex min-w-0 overflow-hidden rounded-md border">
      <div
        ref={gutterRef}
        aria-hidden="true"
        className="overflow-hidden border-r bg-muted/40 px-2 py-2 text-right font-mono text-xs leading-5 whitespace-pre text-muted-foreground select-none"
      >
        {lines.map((_, index) => String(index + 1)).join("\n")}
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={syncScroll}
        disabled={disabled}
        aria-label={ariaLabel}
        wrap="off"
        spellCheck={false}
        data-slot="merge-editor"
        className="field-sizing-fixed max-h-96 min-h-64 w-full flex-1 resize-none overflow-auto bg-transparent px-2 py-2 font-mono text-xs leading-5 whitespace-pre outline-none disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  )
}

/** 内容只读展示：whitespace-pre + 局部滚动，长行不撑破布局。 */
export const MergeContentPreview = ({ content }: { content: string }) => (
  <pre className="max-h-64 min-h-16 overflow-auto rounded-md border bg-muted/20 p-3 font-mono text-xs whitespace-pre">
    {content}
  </pre>
)
