import type { DatabaseFilter, DatabaseSort } from "@shared/api-contract"
import {
  DATABASE_FILTER_MAX,
  DATABASE_PAGE_SIZE_MAX,
  DATABASE_SORT_MAX,
  DatabaseFilterSchema,
  DatabaseIdentifierSchema,
  DatabaseSortSchema,
} from "@shared/api-contract"
import { useMemo, useSyncExternalStore } from "react"
import { z } from "zod"

/**
 * database 页的导航状态放 URL：刷新、分享链接与浏览器前进后退都能恢复。
 * 只读写 db* 参数，其它参数（feature、piTab 等）原样保留；
 * 记录值、签名这类数据不进 URL。
 */
export const DATABASE_URL_PARAMS = {
  table: "dbTable",
  page: "dbPage",
  pageSize: "dbPageSize",
  filters: "dbFilters",
  sorts: "dbSorts",
} as const

export const DEFAULT_DATABASE_PAGE_SIZE = 50
/** 页码上限与服务端一致：再往后翻既没意义也会拖慢扫描。 */
export const MAX_DATABASE_PAGE = 100_000

export type DatabaseUrlState = {
  table: string | null
  page: number
  pageSize: number
  filters: DatabaseFilter[]
  sorts: DatabaseSort[]
}

export const DEFAULT_DATABASE_URL_STATE: DatabaseUrlState = {
  table: null,
  page: 1,
  pageSize: DEFAULT_DATABASE_PAGE_SIZE,
  filters: [],
  sorts: [],
}

const pageSchema = z.coerce.number().int().min(1).max(MAX_DATABASE_PAGE)
const pageSizeSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(DATABASE_PAGE_SIZE_MAX)
const filtersSchema = z.array(DatabaseFilterSchema).max(DATABASE_FILTER_MAX)
const sortsSchema = z.array(DatabaseSortSchema).max(DATABASE_SORT_MAX)

/** 非法或残缺的 JSON 一律按「没有条件」处理，不抛错、也不把脏值带进查询。 */
const parseFilters = (raw: string | null): DatabaseFilter[] => {
  if (raw === null || raw.trim() === "") return []
  try {
    const parsed = filtersSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

const parseSorts = (raw: string | null): DatabaseSort[] => {
  if (raw === null || raw.trim() === "") return []
  try {
    const parsed = sortsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

/** 从当前 URL 读出导航状态；任何非法参数都回落到默认值。 */
export const databaseStateFromUrl = (): DatabaseUrlState => {
  if (typeof window === "undefined") return DEFAULT_DATABASE_URL_STATE
  const params = new URL(window.location.href).searchParams
  const table = DatabaseIdentifierSchema.safeParse(
    params.get(DATABASE_URL_PARAMS.table)
  )
  const page = pageSchema.safeParse(params.get(DATABASE_URL_PARAMS.page))
  const pageSize = pageSizeSchema.safeParse(
    params.get(DATABASE_URL_PARAMS.pageSize)
  )
  return {
    table: table.success ? table.data : null,
    page: page.success ? page.data : DEFAULT_DATABASE_URL_STATE.page,
    pageSize: pageSize.success
      ? pageSize.data
      : DEFAULT_DATABASE_URL_STATE.pageSize,
    filters: parseFilters(params.get(DATABASE_URL_PARAMS.filters)),
    sorts: parseSorts(params.get(DATABASE_URL_PARAMS.sorts)),
  }
}

/** 默认值不写进 URL，链接保持干净。 */
const writeUrl = (next: DatabaseUrlState, mode: "push" | "replace"): void => {
  const url = new URL(window.location.href)
  const set = (key: string, value: string | null): void => {
    if (value === null) url.searchParams.delete(key)
    else url.searchParams.set(key, value)
  }
  set(DATABASE_URL_PARAMS.table, next.table)
  set(DATABASE_URL_PARAMS.page, next.page === 1 ? null : String(next.page))
  set(
    DATABASE_URL_PARAMS.pageSize,
    next.pageSize === DEFAULT_DATABASE_PAGE_SIZE ? null : String(next.pageSize)
  )
  set(
    DATABASE_URL_PARAMS.filters,
    next.filters.length === 0 ? null : JSON.stringify(next.filters)
  )
  set(
    DATABASE_URL_PARAMS.sorts,
    next.sorts.length === 0 ? null : JSON.stringify(next.sorts)
  )
  const target = `${url.pathname}${url.search}${url.hash}`
  // 保留应用内导航标记，App 的返回按钮才认得这是应用内导航。
  const state = { ...window.history.state, macManagerFeature: true }
  if (mode === "push") window.history.pushState(state, "", target)
  else window.history.replaceState(state, "", target)
  window.dispatchEvent(new PopStateEvent("popstate"))
}

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener("popstate", onChange)
  return () => window.removeEventListener("popstate", onChange)
}

/** 快照必须是稳定字符串，否则 useSyncExternalStore 会每渲染都判定为变化。 */
const snapshot = (): string => JSON.stringify(databaseStateFromUrl())
const serverSnapshot = (): string => JSON.stringify(DEFAULT_DATABASE_URL_STATE)

export type DatabaseNavigation = {
  state: DatabaseUrlState
  selectTable: (table: string | null) => void
  setPage: (page: number) => void
  setPageSize: (pageSize: number) => void
  setFilters: (filters: DatabaseFilter[]) => void
  setSorts: (sorts: DatabaseSort[]) => void
  clearQuery: () => void
}

export const useDatabaseNavigation = (): DatabaseNavigation => {
  const encoded = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  const state = useMemo(
    () => JSON.parse(encoded) as DatabaseUrlState,
    [encoded]
  )

  return {
    state,
    selectTable: (table: string | null): void => {
      if (table === state.table) return
      // 切表必须清空旧条件与页码：旧筛选、排序在新表上没有意义
      writeUrl(
        {
          ...DEFAULT_DATABASE_URL_STATE,
          table,
          pageSize: state.pageSize,
        },
        "push"
      )
    },
    setPage: (page: number): void => {
      const next = pageSchema.safeParse(page)
      if (!next.success) return
      writeUrl({ ...state, page: next.data }, "push")
    },
    setPageSize: (pageSize: number): void => {
      const next = pageSizeSchema.safeParse(pageSize)
      if (!next.success) return
      writeUrl({ ...state, pageSize: next.data, page: 1 }, "push")
    },
    setFilters: (filters: DatabaseFilter[]): void => {
      writeUrl({ ...state, filters, page: 1 }, "push")
    },
    setSorts: (sorts: DatabaseSort[]): void => {
      writeUrl({ ...state, sorts, page: 1 }, "push")
    },
    clearQuery: (): void => {
      writeUrl({ ...state, filters: [], sorts: [], page: 1 }, "push")
    },
  }
}
