// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { AI_ASSISTANT_PI_TAB, piTabFromUrl, usePiTab } from "./use-pi-tab"

const setUrl = (search: string): void => {
  window.history.replaceState({}, "", `/${search}`)
}

afterEach(() => {
  setUrl("")
})

describe("piTabFromUrl", () => {
  it("默认 partition 是模型，piTab 决定分区", () => {
    expect(piTabFromUrl()).toBe("models")
    setUrl("?piTab=groups")
    expect(piTabFromUrl()).toBe("groups")
    setUrl("?piTab=assistant")
    expect(piTabFromUrl()).toBe("assistant")
  })

  it("piTab 非法时回落到默认，不带 piTab 的 piRun 深链仍落到 Playground", () => {
    setUrl("?piTab=nope")
    expect(piTabFromUrl()).toBe("models")
    setUrl("?piRun=req_1")
    expect(piTabFromUrl()).toBe("chat")
    // 显式指定优先于 piRun，避免旧链接盖掉新定位。
    setUrl("?piRun=req_1&piTab=assistant")
    expect(piTabFromUrl()).toBe("assistant")
  })
})

describe("usePiTab", () => {
  it("切换分区写进 URL，默认分区不留下多余参数", () => {
    const { result } = renderHook(() => usePiTab())
    expect(result.current.tab).toBe("models")

    act(() => result.current.selectTab(AI_ASSISTANT_PI_TAB))
    expect(result.current.tab).toBe("assistant")
    expect(new URL(window.location.href).searchParams.get("piTab")).toBe(
      "assistant"
    )

    act(() => result.current.selectTab("models"))
    expect(result.current.tab).toBe("models")
    expect(new URL(window.location.href).searchParams.get("piTab")).toBeNull()
  })

  it("带运行深链切换模型时显式写入分区，保留运行和其他参数", () => {
    setUrl("?dbTable=traffic_samples&piRun=req_1&feature=pi&clashTab=proxies")
    const playgroundUrl = window.location.href
    const { result } = renderHook(() => usePiTab())
    expect(result.current.tab).toBe("chat")

    act(() => result.current.selectTab("models"))

    expect(result.current.tab).toBe("models")
    expect(
      Object.fromEntries(new URL(window.location.href).searchParams)
    ).toMatchInlineSnapshot(`
      {
        "clashTab": "proxies",
        "dbTable": "traffic_samples",
        "feature": "pi",
        "piRun": "req_1",
        "piTab": "models",
      }
    `)
    expect(piTabFromUrl()).toBe("models")
    expect(window.history.state.macManagerFeature).toBe(true)

    act(() => {
      window.history.replaceState({}, "", playgroundUrl)
      window.dispatchEvent(new PopStateEvent("popstate"))
    })
    expect(result.current.tab).toBe("chat")
  })

  it("外部把 URL 改到 assistant 时（浮层跳转）能跟随", () => {
    const { result } = renderHook(() => usePiTab())

    act(() => {
      window.history.pushState({}, "", "/?feature=pi&piTab=assistant")
      window.dispatchEvent(new PopStateEvent("popstate"))
    })

    expect(result.current.tab).toBe("assistant")
  })
})
