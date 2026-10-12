import { describe, expect, it } from "vitest"
import {
  AI_ASSISTANT_TOOL_NAME,
  parseSseFrames,
  toUiMessages,
} from "./use-stream-chat"

describe("parseSseFrames", () => {
  it("按空行分帧，未结束的尾巴留在缓冲区", () => {
    const first = parseSseFrames(
      'event: delta\ndata: {"type":"text","delta":"你"}\n\nevent: delta\ndata: {"type'
    )
    expect(first.events).toEqual([
      { event: "delta", data: '{"type":"text","delta":"你"}' },
    ])
    expect(first.rest).toBe('event: delta\ndata: {"type')

    const second = parseSseFrames(`${first.rest}":"text","delta":"好"}\n\n`)
    expect(second.events).toEqual([
      { event: "delta", data: '{"type":"text","delta":"好"}' },
    ])
    expect(second.rest).toBe("")
  })

  it("兼容 CRLF，并支持一段多行 data", () => {
    const { events } = parseSseFrames(
      "event: done\r\ndata: line1\r\ndata: line2\r\n\r\n"
    )
    expect(events).toEqual([{ event: "done", data: "line1\nline2" }])
  })

  it("无 event 字段时按 message 事件处理", () => {
    const { events } = parseSseFrames("data: {}\n\n")
    expect(events).toEqual([{ event: "message", data: "{}" }])
  })
})

describe("toUiMessages", () => {
  it("文本与思考转成 Agent Elements 认识的 part 形状", () => {
    const [message] = toUiMessages([
      {
        id: "m1",
        role: "assistant",
        parts: [
          { type: "thinking", text: "想一想", done: true },
          { type: "text", text: "答案" },
        ],
      },
    ])
    expect(message.id).toBe("m1")
    expect(message.parts).toEqual([
      {
        type: "tool-Thinking",
        toolCallId: "m1-thinking",
        state: "output-available",
        input: { thought: "想一想" },
      },
      { type: "text", text: "答案" },
    ])
  })

  it("自定义工具走用户工具通道，内置工具映射到官方卡片", () => {
    const [message] = toUiMessages([
      {
        id: "m2",
        role: "assistant",
        parts: [
          {
            type: "tool",
            toolCallId: "t1",
            name: AI_ASSISTANT_TOOL_NAME,
            status: "done",
            input: { method: "GET", path: "/api/health" },
            output: { status: 200 },
          },
          {
            type: "tool",
            toolCallId: "t2",
            name: "bash",
            status: "running",
            input: { command: "ls" },
            output: undefined,
          },
        ],
      },
    ])
    expect(message.parts).toEqual([
      {
        type: "tool-mcp__user-tools__call_mac_manager_api",
        toolCallId: "t1",
        state: "output-available",
        input: { method: "GET", path: "/api/health" },
        output: { status: 200 },
      },
      {
        type: "tool-Bash",
        toolCallId: "t2",
        state: "input-available",
        input: { command: "ls" },
        output: undefined,
      },
    ])
  })
})
