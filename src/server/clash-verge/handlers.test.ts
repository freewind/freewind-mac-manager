import { afterEach, describe, expect, it, vi } from "vitest"
import { clashVergeRouter } from "./handlers"

const originalAuto = process.env.CLASH_VERGE_AUTO_DISCOVER

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalAuto === undefined) delete process.env.CLASH_VERGE_AUTO_DISCOVER
  else process.env.CLASH_VERGE_AUTO_DISCOVER = originalAuto
})

describe("Clash Verge handlers", () => {
  it("returns typed unavailable sections instead of claiming online success", async () => {
    delete process.env.CLASH_VERGE_CONTROLLER_URL
    delete process.env.CLASH_VERGE_CONTROLLER_UNIX_SOCKET
    delete process.env.CLASH_VERGE_SECRET
    // 关掉自动发现：测试不连本机真实内核
    process.env.CLASH_VERGE_AUTO_DISCOVER = "0"
    const response = await clashVergeRouter.getClashVergeStatus()
    expect(response.status).toBe(200)
    expect(response.body.availability.state).toBe("not_configured")
    expect(response.body.core.version).toBeNull()
  })

  it("keeps connection sampling read-only", async () => {
    process.env.CLASH_VERGE_CONTROLLER_URL = "http://127.0.0.1:9097"
    process.env.CLASH_VERGE_SECRET = "test-secret"
    const fetchMock = vi.fn(
      async (_input: URL, _init?: RequestInit) => new Response("{}")
    )
    vi.stubGlobal("fetch", fetchMock)
    const response = await clashVergeRouter.getClashVergeConnections()
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("GET")
    expect(response.body.availability.state).toBe("unavailable")
  })
})
