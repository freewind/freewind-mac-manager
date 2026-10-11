import { describe, expect, it } from "vitest"
import { cached, invalidateCached } from "./collect"

describe("cached 失效", () => {
  it("按前缀只失效匹配的键", async () => {
    let calls = 0
    const load = async (): Promise<number> => {
      calls += 1
      return calls
    }

    expect(await cached("docker:images", 60_000, load)).toBe(1)
    expect(await cached("docker:containers", 60_000, load)).toBe(2)
    expect(await cached("disk", 60_000, load)).toBe(3)

    // 写操作只失效 Docker 域，别的域不受影响
    invalidateCached("docker:")
    expect(await cached("docker:images", 60_000, load)).toBe(4)
    expect(await cached("docker:containers", 60_000, load)).toBe(5)
    expect(await cached("disk", 60_000, load)).toBe(3)

    // 不传前缀清空全部
    invalidateCached()
    expect(await cached("disk", 60_000, load)).toBe(6)
  })

  it("前缀不匹配时不失效", async () => {
    let calls = 0
    const load = async (): Promise<number> => {
      calls += 1
      return calls
    }
    expect(await cached("docker:info", 60_000, load)).toBe(1)
    invalidateCached("dockerx:")
    expect(await cached("docker:info", 60_000, load)).toBe(1)
    invalidateCached("docker:")
    expect(await cached("docker:info", 60_000, load)).toBe(2)
  })
})
