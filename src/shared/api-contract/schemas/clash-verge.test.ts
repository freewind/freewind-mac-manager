import { describe, expect, it } from "vitest"
import {
  ClashVergeConnectionsResponseSchema,
  ClashVergeProxiesResponseSchema,
  ClashVergeStatusSchema,
} from "./clash-verge"

const available = { state: "available", message: null } as const

describe("Clash Verge read schemas", () => {
  it("accepts status sections and partial readings", () => {
    expect(
      ClashVergeStatusSchema.parse({
        sampledAt: 100,
        availability: available,
        core: { version: "1.0", meta: true },
        config: { mode: "rule", tunEnabled: false },
        traffic: {
          uploadRate: 4,
          downloadRate: 8,
          uploadTotal: 100,
          downloadTotal: 200,
        },
        sections: { core: available, config: available, traffic: available },
      }).traffic.downloadRate
    ).toBe(8)
    expect(
      ClashVergeStatusSchema.safeParse({
        sampledAt: 100,
        availability: available,
        core: { version: null, meta: null },
        config: { mode: null, tunEnabled: null },
        traffic: {
          uploadRate: null,
          downloadRate: null,
          uploadTotal: null,
          downloadTotal: null,
        },
        sections: {
          core: { state: "unavailable", message: "down" },
          config: available,
          traffic: available,
        },
      }).success
    ).toBe(true)
  })

  it("rejects negative values and excessive connection lists", () => {
    expect(
      ClashVergeStatusSchema.safeParse({
        sampledAt: 100,
        availability: available,
        core: { version: null, meta: null },
        config: { mode: null, tunEnabled: null },
        traffic: {
          uploadRate: -1,
          downloadRate: null,
          uploadTotal: null,
          downloadTotal: null,
        },
        sections: { core: available, config: available, traffic: available },
      }).success
    ).toBe(false)
    expect(
      ClashVergeConnectionsResponseSchema.safeParse({
        sampledAt: 1,
        availability: available,
        total: 201,
        truncated: true,
        connections: Array.from({ length: 201 }, (_, index) => ({
          id: String(index),
          source: null,
          destination: null,
          network: null,
          process: null,
          upload: 0,
          download: 0,
          startedAt: "",
          chains: [],
          rule: null,
          rulePayload: null,
        })),
      }).success
    ).toBe(false)
  })

  it("requires explicit proxy and connection availability metadata", () => {
    expect(
      ClashVergeProxiesResponseSchema.safeParse({ sampledAt: 1, proxies: [] })
        .success
    ).toBe(false)
  })
})
