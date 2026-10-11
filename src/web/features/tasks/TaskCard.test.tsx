// @vitest-environment jsdom

import { TASK_KINDS, type TaskRecord } from "@shared/api-contract"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { TaskCard } from "./TaskCard"

/** 真实的 docker 容器 id 是 64 位十六进制，长短与线上一致。 */
const CONTAINER_ID =
  "cdfcc4c59a7f149f6a46b8e0d1c2a3f45b6d7e8f90a1b2c3d4e5f60718293a4b"

/** 删除容器任务：target、progress.stage、message 都带着同一个长 id。 */
const doneTask: TaskRecord = {
  id: "task-docker-1",
  requestId: "req_docker_1",
  kind: TASK_KINDS.dockerAction,
  target: `docker:container:${CONTAINER_ID}`,
  status: "done",
  progress: {
    done: 0,
    total: null,
    bytesDone: null,
    bytesTotal: null,
    // 服务端 stageOf() 生成的就是这句，任务卡把它当 detail 显示
    stage: `删除容器 ${CONTAINER_ID}`,
    currentTarget: null,
  },
  message: `已删除容器 ${CONTAINER_ID}`,
  error: null,
  // message 与 result.message 一致时 TaskResult 不重复渲染
  result: { message: `已删除容器 ${CONTAINER_ID}` },
  startedAt: 1_700_000_000,
  finishedAt: 1_700_000_012,
  updatedAt: 1_700_000_012,
}

const failedTask: TaskRecord = {
  id: "task-docker-2",
  requestId: "req_docker_2",
  kind: TASK_KINDS.dockerAction,
  target: `docker:container:${CONTAINER_ID}`,
  status: "failed",
  progress: null,
  message: null,
  error: `删除容器 ${CONTAINER_ID} 失败：docker 拒绝删除正在运行的容器`,
  result: null,
  startedAt: 1_700_000_000,
  finishedAt: 1_700_000_005,
  updatedAt: 1_700_000_005,
}

afterEach(() => {
  cleanup()
})

describe("任务卡", () => {
  it("长容器标识的 target、detail、message 都是完整文本", () => {
    render(<TaskCard task={doneTask} />)

    // target 一行：完整值在 DOM 里，另可用 title 查看（视觉上会省略）
    const targetNode = screen.getByText(`docker:container:${CONTAINER_ID}`)
    expect(targetNode.getAttribute("title")).toBe(
      `docker:container:${CONTAINER_ID}`
    )

    // detail（progress.stage）与 message 同样必须完整可取
    expect(screen.getByText(`删除容器 ${CONTAINER_ID}`)).toBeTruthy()
    expect(screen.getByText(`已删除容器 ${CONTAINER_ID}`)).toBeTruthy()
  })

  it("失败原因里的长容器标识也是完整文本", () => {
    render(<TaskCard task={failedTask} />)

    expect(
      screen.getByText(
        `删除容器 ${CONTAINER_ID} 失败：docker 拒绝删除正在运行的容器`
      )
    ).toBeTruthy()
  })
})
