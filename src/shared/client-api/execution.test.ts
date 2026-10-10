import { describe, expect, it } from "vitest"
import { ApiRequestError } from "./client"
import { runExecution } from "./execution"

const accepted = {
  taskId: "task-1",
  kind: "disk_scan",
  status: "running" as const,
  startedAt: 1000,
}

describe("execution handling", () => {
  it("returns the completed body for 200 and 201", async () => {
    expect(
      await runExecution<{ message: string }>(async () => ({
        status: 200,
        body: { message: "已删除" },
      }))
    ).toMatchInlineSnapshot(`
      {
        "body": {
          "message": "已删除",
        },
        "kind": "completed",
        "status": 200,
      }
    `)

    const created = await runExecution<{ id: number }>(async () => ({
      status: 201,
      body: { id: 9 },
    }))
    expect(created).toMatchObject({ kind: "completed", status: 201 })
  })

  it("treats 202 as accepted and never exposes a business result", async () => {
    const result = await runExecution<{ snapshotId: number }>(async () => ({
      status: 202,
      body: accepted,
    }))
    expect(result.kind).toBe("accepted")
    expect(result.body).toEqual(accepted)
    // 受理分支没有完成结果字段，因此不可能被误当成执行成功
    expect(result.body).not.toHaveProperty("snapshotId")
  })

  it("rejects a 202 body that does not match the receipt contract", async () => {
    await expect(
      runExecution(async () => ({ status: 202, body: { ok: true } }))
    ).rejects.toThrow(ApiRequestError)
    // 受理状态写成已完成同样不接受
    await expect(
      runExecution(async () => ({
        status: 202,
        body: { ...accepted, status: "done" },
      }))
    ).rejects.toThrow(/受理回执无法解析/)
  })

  it("keeps HTTP failures as errors instead of completed results", async () => {
    try {
      await runExecution(async () => ({
        status: 409,
        body: { message: "该目标已有任务在执行" },
      }))
      throw new Error("expected a failure")
    } catch (error) {
      expect(error).toBeInstanceOf(ApiRequestError)
      expect(error).toMatchObject({ status: 409 })
      expect((error as Error).message).toContain("该目标已有任务在执行")
    }
  })

  it("surfaces an unknown result as an unknown-result error", async () => {
    try {
      await runExecution(async () => {
        throw new ApiRequestError(
          "请求结果未知，请重新读取确认",
          null,
          undefined,
          undefined,
          true,
          "req_1"
        )
      })
      throw new Error("expected a failure")
    } catch (error) {
      expect((error as ApiRequestError).resultUnknown).toBe(true)
      expect((error as ApiRequestError).requestId).toBe("req_1")
    }
  })
})
