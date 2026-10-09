import { describe, expect, it } from "vitest"
import { ApiErrorSchema, ActionResponseSchema } from "./disk-growth"

describe("shared API response schemas", () => {
  it("accepts message responses and rejects malformed payloads", () => {
    expect(ApiErrorSchema.safeParse({ message: "Failed" }).success).toBe(true)
    expect(ActionResponseSchema.safeParse({ message: "Done" }).success).toBe(
      true
    )
    expect(ApiErrorSchema.safeParse({ error: "Failed" }).success).toBe(false)
    expect(ActionResponseSchema.safeParse({ ok: true }).success).toBe(false)
  })
})
