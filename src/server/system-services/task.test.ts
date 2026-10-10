import { createExecutorRegistry, taskExecutors } from "@server/tasks/executors"
import { TASK_KINDS } from "@shared/api-contract"
import { describe, expect, it } from "vitest"
import {
  runServiceActionTask,
  SERVICE_ACTION_KIND,
  ServiceActionPayloadSchema,
  serviceTargetOf,
} from "./task"

describe("service action payload", () => {
  it("accepts only the known actions and identifiers", () => {
    expect(
      ServiceActionPayloadSchema.safeParse({
        action: "restart",
        label: "com.example.agent",
        domain: "user",
      }).success
    ).toBe(true)
    expect(
      ServiceActionPayloadSchema.safeParse({
        action: "rm -rf /",
        label: "com.example.agent",
        domain: "user",
      }).success
    ).toBe(false)
    expect(
      ServiceActionPayloadSchema.safeParse({ action: "start", label: "" })
        .success
    ).toBe(false)
    // 不接受多余的命令/参数字段：外部输入无法指定要执行什么
    expect(
      ServiceActionPayloadSchema.safeParse({
        action: "start",
        label: "com.example.agent",
        domain: "user",
        command: "/bin/sh",
      }).success
    ).toBe(true)
    expect(serviceTargetOf("user", "com.example.agent")).toBe(
      "service:user/com.example.agent"
    )
  })

  it("rejects a malformed payload before running anything", async () => {
    await expect(
      runServiceActionTask({
        payload: { action: "unknown", label: "x", domain: "user" },
        report: () => undefined,
      })
    ).rejects.toThrow("系统服务动作载荷非法")
  })
})

describe("service executor wiring", () => {
  it("registers the action kind", () => {
    const registry = createExecutorRegistry(taskExecutors)
    expect(registry.get(SERVICE_ACTION_KIND)).not.toBeNull()
    expect(registry.kinds()).toContain(TASK_KINDS.serviceAction)
  })
})
