import { afterEach, describe, expect, it, vi } from "vitest"
import {
  fetchClashVergeConnections,
  fetchClashVergeProxies,
  fetchClashVergeStatus,
} from "./clash-verge"

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })

afterEach(() => vi.unstubAllGlobals())

describe("Clash Verge client API", () => {
  it("uses only the three declared read endpoints", async () => {
    const fetchMock = vi.fn(async (input: string, _init?: RequestInit) => {
      const path = new URL(input, "http://localhost").pathname
      if (path.endsWith("/status")) return json({})
      if (path.endsWith("/proxies")) return json({})
      if (path.endsWith("/connections")) return json({})
      throw new Error("unexpected endpoint")
    })
    vi.stubGlobal("fetch", fetchMock)
    await fetchClashVergeStatus()
    await fetchClashVergeProxies()
    await fetchClashVergeConnections()
    expect(
      fetchMock.mock.calls.map(
        ([input]) => new URL(input, "http://localhost").pathname
      )
    ).toEqual([
      "/api/clash-verge/status",
      "/api/clash-verge/proxies",
      "/api/clash-verge/connections",
    ])
    expect(
      fetchMock.mock.calls.every(([, init]) => init?.method === "GET")
    ).toBe(true)
  })
})
