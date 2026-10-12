// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
  DATABASE_URL_PARAMS,
  DEFAULT_DATABASE_PAGE_SIZE,
  DEFAULT_DATABASE_URL_STATE,
  databaseStateFromUrl,
  useDatabaseNavigation,
} from "./navigation"

const setUrl = (search: string): void => {
  window.history.replaceState({}, "", `/${search}`)
}

const currentParams = (): URLSearchParams =>
  new URL(window.location.href).searchParams

afterEach(() => {
  cleanup()
  setUrl("")
})

describe("databaseStateFromUrl", () => {
  it("returns the defaults when the URL carries nothing", () => {
    setUrl("")
    expect(databaseStateFromUrl()).toEqual(DEFAULT_DATABASE_URL_STATE)
  })

  it("reads table, page, pageSize, filters and sorts from the URL", () => {
    const filters = [
      {
        column: "qty",
        operator: "gte",
        value: { type: "integer", value: "5" },
      },
    ]
    const sorts = [{ column: "id", direction: "desc" }]
    setUrl(
      `?feature=database&${new URLSearchParams({
        [DATABASE_URL_PARAMS.table]: "items",
        [DATABASE_URL_PARAMS.page]: "3",
        [DATABASE_URL_PARAMS.pageSize]: "20",
        [DATABASE_URL_PARAMS.filters]: JSON.stringify(filters),
        [DATABASE_URL_PARAMS.sorts]: JSON.stringify(sorts),
      }).toString()}`
    )
    expect(databaseStateFromUrl()).toEqual({
      table: "items",
      page: 3,
      pageSize: 20,
      filters,
      sorts,
    })
  })

  it("falls back to defaults for illegal values instead of throwing", () => {
    setUrl(
      `?${new URLSearchParams({
        [DATABASE_URL_PARAMS.table]: "",
        [DATABASE_URL_PARAMS.page]: "0",
        [DATABASE_URL_PARAMS.pageSize]: "999",
        [DATABASE_URL_PARAMS.filters]: "not-json",
        [DATABASE_URL_PARAMS.sorts]: JSON.stringify([{ column: "id" }]),
      }).toString()}`
    )
    expect(databaseStateFromUrl()).toEqual(DEFAULT_DATABASE_URL_STATE)

    // 未知算子与超量筛选也要被挡掉
    setUrl(
      `?${new URLSearchParams({
        [DATABASE_URL_PARAMS.filters]: JSON.stringify([
          {
            column: "name",
            operator: "like",
            value: { type: "text", value: "a" },
          },
        ]),
        [DATABASE_URL_PARAMS.page]: "100001",
      }).toString()}`
    )
    expect(databaseStateFromUrl().filters).toEqual([])
    expect(databaseStateFromUrl().page).toBe(1)
  })
})

describe("useDatabaseNavigation", () => {
  it("writes the state into the URL and keeps other params", () => {
    setUrl("?feature=database&piTab=chat")
    const { result } = renderHook(() => useDatabaseNavigation())

    act(() => result.current.selectTable("items"))
    act(() =>
      result.current.setFilters([
        {
          column: "qty",
          operator: "gte",
          value: { type: "integer", value: "5" },
        },
      ])
    )
    act(() => result.current.setSorts([{ column: "id", direction: "desc" }]))
    act(() => result.current.setPage(2))

    expect(result.current.state).toEqual({
      table: "items",
      page: 2,
      pageSize: DEFAULT_DATABASE_PAGE_SIZE,
      filters: [
        {
          column: "qty",
          operator: "gte",
          value: { type: "integer", value: "5" },
        },
      ],
      sorts: [{ column: "id", direction: "desc" }],
    })
    // 既有 feature 参数保留；默认值不写进 URL
    expect(currentParams().get("feature")).toBe("database")
    expect(currentParams().get("piTab")).toBe("chat")
    expect(currentParams().get("dbPage")).toBe("2")
    expect(currentParams().get("dbPageSize")).toBeNull()
    // 记录值与签名绝不进 URL
    expect(currentParams().has("dbSignature")).toBe(false)
    expect(currentParams().has("dbValues")).toBe(false)
    expect(databaseStateFromUrl()).toEqual(result.current.state)
  })

  it("clears old filters, sorts and page when switching tables", () => {
    setUrl("")
    const { result } = renderHook(() => useDatabaseNavigation())
    act(() => result.current.selectTable("items"))
    act(() =>
      result.current.setFilters([
        {
          column: "qty",
          operator: "gte",
          value: { type: "integer", value: "5" },
        },
      ])
    )
    act(() => result.current.setSorts([{ column: "id", direction: "desc" }]))
    act(() => result.current.setPageSize(20))
    act(() => result.current.setPage(4))

    act(() => result.current.selectTable("other"))
    expect(result.current.state).toEqual({
      table: "other",
      page: 1,
      // 页大小是显示偏好，切表时保留
      pageSize: 20,
      filters: [],
      sorts: [],
    })
    expect(currentParams().get("dbFilters")).toBeNull()
    expect(currentParams().get("dbSorts")).toBeNull()
    expect(currentParams().get("dbPage")).toBeNull()
  })

  it("clears filters and sorts on demand", () => {
    setUrl("")
    const { result } = renderHook(() => useDatabaseNavigation())
    act(() => result.current.selectTable("items"))
    act(() => result.current.setSorts([{ column: "id", direction: "desc" }]))
    act(() => result.current.clearQuery())
    expect(result.current.state.filters).toEqual([])
    expect(result.current.state.sorts).toEqual([])
    expect(result.current.state.page).toBe(1)
  })

  it("ignores illegal page and pageSize arguments", () => {
    setUrl("")
    const { result } = renderHook(() => useDatabaseNavigation())
    act(() => result.current.setPage(0))
    act(() => result.current.setPageSize(999))
    expect(result.current.state.page).toBe(1)
    expect(result.current.state.pageSize).toBe(DEFAULT_DATABASE_PAGE_SIZE)
  })

  it("restores the state after going back", async () => {
    setUrl("")
    const { result } = renderHook(() => useDatabaseNavigation())
    act(() => result.current.selectTable("items"))
    act(() => result.current.selectTable("other"))
    expect(result.current.state.table).toBe("other")

    act(() => {
      window.history.back()
    })
    await waitFor(() => expect(result.current.state.table).toBe("items"))
  })
})
