import { describe, expect, it } from "vitest"
import { formatBytes, formatSignedBytes, formatTimestamp } from "./format"

describe("formatBytes", () => {
  it("formats zero, bytes, and scaled values", () => {
    expect([
      formatBytes(0),
      formatBytes(1),
      formatBytes(1024),
      formatBytes(1536),
    ]).toMatchInlineSnapshot(`
      [
        "0",
        "1 B",
        "1.0 KB",
        "1.5 KB",
      ]
    `)
  })

  it("formats signed values without losing magnitude", () => {
    expect([formatSignedBytes(1536), formatSignedBytes(-1536)]).toEqual([
      "+1.5 KB",
      "-1.5 KB",
    ])
  })

  it("formats timestamps in local time", () => {
    const seconds = new Date(2024, 0, 2, 3, 4).getTime() / 1000
    expect(formatTimestamp(seconds)).toBe("2024-01-02 03:04")
  })
})
