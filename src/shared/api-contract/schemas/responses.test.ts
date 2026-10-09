import { describe, expect, it } from "vitest"
import { ApiErrorSchema, ActionResponseSchema } from "./common"
import { SaveFileContentBodySchema, TransferEntriesBodySchema } from "./files"
import { KillPortProcessesBodySchema } from "./ports"
import { KillProcessesBodySchema } from "./common"
import { ServiceTargetBodySchema } from "./system-services"

describe("shared API schemas", () => {
  it("accepts message responses and rejects malformed payloads", () => {
    expect(ApiErrorSchema.safeParse({ message: "Failed" }).success).toBe(true)
    expect(ActionResponseSchema.safeParse({ message: "Done" }).success).toBe(
      true
    )
    expect(ApiErrorSchema.safeParse({ error: "Failed" }).success).toBe(false)
    expect(ActionResponseSchema.safeParse({ ok: true }).success).toBe(false)
  })

  it("enforces dangerous operation input limits", () => {
    expect(
      TransferEntriesBodySchema.safeParse({
        paths: Array.from({ length: 65 }, (_, index) => `/tmp/${index}`),
        destPath: "/tmp/destination",
      }).success
    ).toBe(false)
    expect(
      SaveFileContentBodySchema.safeParse({
        path: "/tmp/a.txt",
        content: "x".repeat(2 * 1024 * 1024 + 1),
      }).success
    ).toBe(false)
    expect(
      KillProcessesBodySchema.safeParse({
        pids: Array.from({ length: 65 }, (_, index) => index + 2),
      }).success
    ).toBe(false)
    expect(
      KillPortProcessesBodySchema.safeParse({
        port: 8080,
        pids: [1],
      }).success
    ).toBe(true)
    expect(
      ServiceTargetBodySchema.safeParse({
        domain: "user",
        label: "com.example.service/unsafe",
      }).success
    ).toBe(false)
  })
})
