import { describe, expect, it } from "vitest"
import {
  beginSessionRun,
  disposeSession,
  endSessionRun,
  isSessionRunning,
} from "./session"

/**
 * 在途锁是纯内存状态，不碰 SDK 也不碰数据库：
 * 它保证同一会话同时只有一次运行，且必须在进入 SSE 之前申请。
 */
describe("会话在途锁", () => {
  it("同一会话第二次申请被拒，释放后可以再申请", () => {
    expect(beginSessionRun("lock-1")).toBe(true)
    expect(isSessionRunning("lock-1")).toBe(true)
    expect(beginSessionRun("lock-1")).toBe(false)

    endSessionRun("lock-1")
    expect(isSessionRunning("lock-1")).toBe(false)
    expect(beginSessionRun("lock-1")).toBe(true)
    endSessionRun("lock-1")
  })

  it("不同会话互不影响", () => {
    expect(beginSessionRun("lock-a")).toBe(true)
    expect(beginSessionRun("lock-b")).toBe(true)
    endSessionRun("lock-a")
    expect(isSessionRunning("lock-a")).toBe(false)
    expect(isSessionRunning("lock-b")).toBe(true)
    endSessionRun("lock-b")
  })

  it("丢弃会话时一并释放锁，避免槽位泄漏", () => {
    beginSessionRun("lock-2")
    disposeSession("lock-2")
    expect(isSessionRunning("lock-2")).toBe(false)
    expect(beginSessionRun("lock-2")).toBe(true)
    endSessionRun("lock-2")
  })
})
