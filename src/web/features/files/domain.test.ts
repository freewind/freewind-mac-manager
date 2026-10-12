import { describe, expect, it } from "vitest"
import { relativeToRoot } from "./domain"

describe("relativeToRoot", () => {
  it("去掉搜索根前缀，只留子目录与文件名", () => {
    expect(relativeToRoot("/Users/demo", "/Users/demo/sub/a.txt")).toBe(
      "sub/a.txt"
    )
    // 根带尾斜杠时不会多出一层空目录
    expect(relativeToRoot("/Users/demo/", "/Users/demo/a.txt")).toBe("a.txt")
    // 根自身与不在根内的路径原样返回，不猜相对位置
    expect(relativeToRoot("/Users/demo", "/Users/demo")).toBe("/Users/demo")
    expect(relativeToRoot("/Users/demo", "/other/a.txt")).toBe("/other/a.txt")
    expect(relativeToRoot("", "/Users/demo/a.txt")).toBe("/Users/demo/a.txt")
  })
})
