import { useNavigate, useSearch } from "@tanstack/react-router"

/** Pi 页的分区；AI助手是助手域在 Pi 页的入口。 */
export const PI_TABS = [
  "models",
  "history",
  "settings",
  "probe",
  "chat",
  "assistant",
] as const

export type PiTab = (typeof PI_TABS)[number]

export const DEFAULT_PI_TAB: PiTab = "models"

/** AI 助手设置所在的子标签：浮层里的「去设置模型」定位到这里。 */
export const AI_ASSISTANT_PI_TAB: PiTab = "assistant"

const TAB_KEYS: readonly string[] = PI_TABS

/**
 * 分区状态放 URL，而不是组件内部 state：
 * 刷新、分享链接、浏览器返回，以及从 AI 助手浮层跳过来，都能定位到正确分区。
 */
export const usePiTab = (): {
  tab: PiTab
  selectTab: (tab: PiTab) => void
} => {
  const search = useSearch({ strict: false }) as Record<
    string,
    string | undefined
  >
  const navigate = useNavigate()
  const { piTab, piRun } = search
  const tab: PiTab =
    piTab && TAB_KEYS.includes(piTab)
      ? (piTab as PiTab)
      : // 兼容既有深链：带 piRun 的链接仍然直接落到 Playground。
        piRun
        ? "chat"
        : DEFAULT_PI_TAB

  return {
    tab,
    selectTab: (next: PiTab): void => {
      if (next === tab) return
      void navigate({
        to: ".",
        search: (prev: Record<string, string | undefined>) => ({
          ...prev,
          // 带运行深链时必须显式指定模型页，否则解析会再次回落到 Playground；
          // 默认分区不写进 URL，链接保持干净。
          piTab: next === DEFAULT_PI_TAB && !prev.piRun ? undefined : next,
        }),
      })
    },
  }
}
