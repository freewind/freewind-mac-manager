import { useSyncExternalStore } from "react"

/** 读当前页面的明暗：项目用 <html class="dark"> 表示暗色。 */
const readThemeType = (): "light" | "dark" =>
  typeof document !== "undefined" &&
  document.documentElement.classList.contains("dark")
    ? "dark"
    : "light"

/** 监听 <html class> 的变化：主题切换时通知订阅者。 */
const subscribeTheme = (onChange: () => void): (() => void) => {
  if (typeof window === "undefined") return () => {}
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  })
  return () => observer.disconnect()
}

/**
 * 跟随页面主题的明暗判断。
 * 用 useSyncExternalStore 直接订阅 DOM 变化，服务端渲染按 light 处理，
 * 供需要显式指定主题的第三方渲染组件使用。
 */
export const useThemeType = (): "light" | "dark" =>
  useSyncExternalStore(subscribeTheme, readThemeType, () => "light")
