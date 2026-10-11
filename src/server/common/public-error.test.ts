import { expect, it } from "vitest"
import { publicSystemError } from "./public-error"

it.each([
  ["ENOENT", 404],
  ["EACCES", 403],
  ["EPERM", 403],
  ["EEXIST", 409],
  ["EBUSY", 409],
])("maps %s without exposing internal text", (code, status) => {
  expect(
    publicSystemError(
      Object.assign(new Error("secret-token /private/internal"), { code })
    )
  ).toMatchObject({ status })
  expect(
    JSON.stringify(
      publicSystemError(Object.assign(new Error("secret-token"), { code }))
    )
  ).not.toContain("secret-token")
})
it("redacts unexpected failures", () => {
  expect(publicSystemError(new Error("sensitive command output"))).toEqual({
    status: 500,
    body: { message: "操作未能完成，请重新读取目标核实" },
  })
})
