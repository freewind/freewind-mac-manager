import { beforeEach, describe, expect, it, vi } from "vitest"
import { runSaveFrpTask, SaveFrpPayloadSchema } from "./task"

const { save } = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock("./service", () => ({ saveFrpConfig: save }))
const payload = {
  server: {
    serverAddr: "example.test",
    serverPort: 7000,
    authMethod: "token",
    authToken: "test",
  },
  proxies: [
    {
      name: "test",
      type: "tcp",
      localIP: "127.0.0.1",
      localPort: 3000,
      remotePort: 3001,
    },
  ],
}
beforeEach(() => {
  save.mockReset()
})
describe("FRP task payload", () => {
  it.each([
    {},
    { server: {}, proxies: [] },
    { ...payload, proxies: [{ ...payload.proxies[0], localPort: "3000" }] },
    { ...payload, proxies: [{ ...payload.proxies[0], type: "invalid" }] },
  ])("rejects malformed input before writing", async (input) => {
    expect(SaveFrpPayloadSchema.safeParse(input).success).toBe(false)
    const report = vi.fn()
    await expect(runSaveFrpTask({ payload: input, report })).rejects.toThrow(
      "FRP 配置载荷非法"
    )
    expect(save).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
  })
  it("passes validated input and reports completion only after saving", async () => {
    const report = vi.fn()
    save.mockImplementation(async () => {
      expect(report).toHaveBeenCalledTimes(1)
      return "已写入配置"
    })
    const outcome = await runSaveFrpTask({ payload, report })
    expect(save).toHaveBeenCalledWith(payload)
    expect(outcome).toMatchInlineSnapshot(`
      {
        "message": "已写入配置",
        "result": {
          "message": "已写入配置",
        },
      }
    `)
    expect(report.mock.calls.at(-1)?.[0]).toMatchObject({
      done: 1,
      total: 1,
      stage: "完成",
    })
  })
})
