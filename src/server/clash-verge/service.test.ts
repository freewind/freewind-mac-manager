import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getClashVergeConnections,
  getClashVergeProxies,
  getClashVergeStatus,
} from "./service"

afterEach(() => vi.unstubAllGlobals())

describe("Clash Verge read service", () => {
  it("把控制接口的 404 与 429 说清楚，而不是笼统报不可用", async () => {
    process.env.CLASH_VERGE_CONTROLLER_URL = "http://127.0.0.1:9097"
    process.env.CLASH_VERGE_SECRET = "test-secret"

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 }))
    )
    const notFound = await getClashVergeStatus()
    expect(notFound.availability.state).toBe("unavailable")
    expect(notFound.availability.message).toContain("没有这个路径")

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 429 }))
    )
    const limited = await getClashVergeStatus()
    expect(limited.availability.state).toBe("unavailable")
    expect(limited.availability.message).toContain("过于频繁")
  })

  it("projects status without returning raw config fields", async () => {
    const bodies: Record<string, unknown> = {
      version: { version: "1.2", meta: true },
      configs: {
        mode: "rule",
        tun: { enable: false },
        secret: "must-not-escape",
      },
      traffic: { up: 1, down: 2, upTotal: 3, downTotal: 4 },
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (input: URL) =>
          new Response(JSON.stringify(bodies[input.pathname.slice(1)]), {
            status: 200,
          })
      )
    )
    process.env.CLASH_VERGE_CONTROLLER_URL = "http://127.0.0.1:9097"
    process.env.CLASH_VERGE_SECRET = "test-secret"
    const result = await getClashVergeStatus()
    expect(result).toMatchObject({
      availability: { state: "available" },
      core: { version: "1.2", meta: true },
      config: { mode: "rule", tunEnabled: false },
      traffic: { downloadRate: 2, uploadTotal: 3 },
    })
    expect(JSON.stringify(result)).not.toContain("must-not-escape")
  })

  it("reports stopped controller sections as unavailable", async () => {
    process.env.CLASH_VERGE_CONTROLLER_URL = "http://127.0.0.1:9097"
    process.env.CLASH_VERGE_SECRET = "test-secret"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline")
      })
    )
    const result = await getClashVergeStatus()
    expect(result.availability.state).toBe("unavailable")
    expect(result.sections.core.state).toBe("unavailable")
    expect(result.core.version).toBeNull()
  })

  it("exposes group selection and only existing delay history", async () => {
    process.env.CLASH_VERGE_CONTROLLER_URL = "http://127.0.0.1:9097"
    process.env.CLASH_VERGE_SECRET = "test-secret"
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              proxies: {
                SELECTOR: {
                  type: "Selector",
                  now: "Node A",
                  all: ["Node A", "Node B"],
                  history: [{ time: "2026-01-01T00:00:00Z", delay: 42 }],
                },
              },
            })
          )
      )
    )
    const result = await getClashVergeProxies()
    expect(result.proxies[0]).toMatchObject({
      name: "SELECTOR",
      selected: "Node A",
      members: ["Node A", "Node B"],
      delays: [{ delay: 42 }],
    })
  })

  it("bounds connection output to 200 and marks truncation", async () => {
    process.env.CLASH_VERGE_CONTROLLER_URL = "http://127.0.0.1:9097"
    process.env.CLASH_VERGE_SECRET = "test-secret"
    const connections = Array.from({ length: 205 }, (_, index) => ({
      id: String(index),
      metadata: {
        sourceIP: "127.0.0.1",
        destinationIP: "example.test",
        network: "tcp",
      },
      upload: 1,
      download: 2,
      start: "2026-01-01T00:00:00Z",
      chains: ["DIRECT"],
      rule: "MATCH",
      rulePayload: "",
    }))
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ connections })))
    )
    const result = await getClashVergeConnections()
    expect(result.total).toBe(205)
    expect(result.truncated).toBe(true)
    expect(result.connections).toHaveLength(200)
    // 上限单一来源：响应携带后端 limit，前端文案不再写死 200。
    expect(result.limit).toBe(200)
  })
})
