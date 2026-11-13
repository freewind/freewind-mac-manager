import { useNavigate, useSearch } from "@tanstack/react-router"

/**
 * 把「当前分区」放进 URL 查询参数：刷新、分享链接与浏览器返回都能恢复原分区。
 * 只覆盖「单参数、合法值之外回落 fallback」的同构分区；带额外深链语义的分区
 * （如 Pi 页的 piRun）读写规则不同，不适用本 hook，应保留自己的读写逻辑。
 */
export const useUrlTab = <Tab extends string>(
  param: string,
  tabs: readonly Tab[],
  fallback: Tab
): { tab: Tab; selectTab: (tab: Tab) => void } => {
  const search = useSearch({ strict: false }) as Record<
    string,
    string | undefined
  >
  const navigate = useNavigate()
  const raw = search[param]
  const tab =
    typeof raw === "string" && tabs.includes(raw as Tab)
      ? (raw as Tab)
      : fallback

  return {
    tab,
    selectTab: (next: Tab): void => {
      if (next === tab) return
      // 回落默认值时删除参数，URL 不出现「参数=默认值」的冗余形态。
      void navigate({
        to: ".",
        search: (prev: Record<string, string | undefined>) => ({
          ...prev,
          [param]: next === fallback ? undefined : next,
        }),
      })
    },
  }
}
