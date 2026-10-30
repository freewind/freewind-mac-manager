import type { AiCallMessage } from "@shared/api-contract"
import { cn } from "cn"
import { useEffect, useRef } from "react"

/**
 * 通话的文字记录。
 *
 * 用户说的话和 AI 说的话都留在屏幕上：语音通话最容易丢的就是「刚才说了
 * 什么」，边听边看才补得回来。正在生成的回答作为最后一条临时消息显示，
 * 落库后由真实消息取代。
 *
 * 被打断的回答要标出来：那半句没有念完，不能让回看的人以为它说全了。
 */
export const TranscriptList = (props: {
  messages: AiCallMessage[]
  /**
   * 正在生成、还没落库的回答。
   *
   * 回答落库后消息列表里已经有一条同样的内容；这里用「最后一条回答以它结尾」
   * 判断是否已经落库，落库后就不再画临时气泡，否则会看到同一句出现两次。
   */
  liveText: string
  className?: string
}) => {
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const count = props.messages.length
  const live = props.liveText
  const settled = [...props.messages]
    .reverse()
    .find((message) => message.role === "agent")
  const liveTrimmed = live.trim()
  const alreadyStored =
    settled !== undefined &&
    liveTrimmed !== "" &&
    settled.body.trim().endsWith(liveTrimmed)
  const liveLength = alreadyStored ? 0 : liveTrimmed.length

  // 新内容到达就贴到底部：通话时用户不该还要手动滚动才看到最新一句。
  // 依赖用的是「条数」与「已生成字数」，它们在 effect 里参与判断，
  // 不这样写就只能靠额外状态驱动重滚。
  useEffect(() => {
    if (count === 0 && liveLength === 0) return
    bottomRef.current?.scrollIntoView({ block: "end" })
  }, [count, liveLength])

  const empty = count === 0 && !live
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col gap-3 overflow-y-auto",
        props.className
      )}
    >
      {empty ? (
        <p className="m-auto text-sm text-muted-foreground">还没有说话</p>
      ) : null}
      {props.messages.map((message) => (
        <div
          key={message.id}
          className={cn(
            "flex flex-col gap-1",
            message.role === "user" ? "items-end" : "items-start"
          )}
        >
          <div
            className={cn(
              "max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap",
              message.role === "user"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground"
            )}
          >
            {message.body}
          </div>
          {message.interrupted ? (
            <span className="px-1 text-xs text-muted-foreground">被打断</span>
          ) : null}
        </div>
      ))}
      {live && !alreadyStored ? (
        <div className="flex flex-col items-start gap-1">
          <div className="max-w-[85%] rounded-2xl bg-muted px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
            {live}
          </div>
        </div>
      ) : null}
      <div ref={bottomRef} aria-hidden className="h-px w-full shrink-0" />
    </div>
  )
}
