import { describe, expect, it } from "vitest"
import { ApiRequestError, unwrap } from "./client"

describe("client response handling", () => {
  it("returns successful bodies and preserves HTTP failure details", () => {
    expect(
      unwrap<{ value: number }>({ status: 200, body: { value: 1 } })
    ).toEqual({
      value: 1,
    })

    try {
      unwrap({ status: 409, body: { message: "状态冲突" } })
      throw new Error("expected unwrap to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(ApiRequestError)
      expect(error).toMatchObject({
        status: 409,
        responseBody: { message: "状态冲突" },
      })
      expect((error as Error).message).toContain("状态冲突")
    }
  })

  it("marks write request failures as having an unknown result", () => {
    const error = new ApiRequestError(
      "请求结果未知，请重新读取确认",
      null,
      undefined,
      undefined,
      true
    )
    expect(error.resultUnknown).toBe(true)
    expect(error.status).toBeNull()
  })
  it("uses plain text when a server does not return JSON", () => {
    expect(() => unwrap({ status: 502, body: "upstream unavailable" })).toThrow(
      "upstream unavailable"
    )
  })
})
