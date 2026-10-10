import { describe, expect, it } from "vitest"
import {
  fileDirectoryTarget,
  fileMutationLockTarget,
  fileRevealTaskTarget,
  fileTaskTarget,
} from "./task-targets"

describe("file task target", () => {
  it("uses one lock for all file mutations", () => {
    expect(fileDirectoryTarget("/root")).toBe("files:dir:%2Froot")
    expect(fileDirectoryTarget("/root/sub")).toBe("files:dir:%2Froot%2Fsub")
    expect(fileTaskTarget(["/root/sub/b", "/root/a"])).toBe(
      "files:%2Froot%2Fa|%2Froot%2Fsub%2Fb"
    )
    expect(fileMutationLockTarget()).toBe("files:mutations")
  })

  it("keeps Finder reveal independent from file mutations", () => {
    expect(fileRevealTaskTarget("/root/a")).not.toBe(
      fileTaskTarget(["/root/a"])
    )
    expect(fileRevealTaskTarget("/root/a")).not.toBe(
      fileRevealTaskTarget("/root/b")
    )
    expect(fileMutationLockTarget()).not.toBe(fileRevealTaskTarget("/root/a"))
  })
})
