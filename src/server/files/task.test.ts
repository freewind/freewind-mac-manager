import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import {
  copyFile as copyFileAsync,
  link as linkAsync,
  rm as rmAsync,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createExecutorRegistry, taskExecutors } from "@server/tasks/executors"
import { TASK_KINDS } from "@shared/api-contract"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  copyEntries,
  deleteEntries,
  type FileOperationProgress,
  moveEntries,
} from "./service"
import { runCopyTask, runDeleteTask, runMoveTask } from "./task"

let root: string
let source: string
let destination: string

const makeTree = (): void => {
  mkdirSync(path.join(source, "nested"), { recursive: true })
  writeFileSync(path.join(source, "a.txt"), "a".repeat(10))
  writeFileSync(path.join(source, "nested", "b.txt"), "b".repeat(20))
}

beforeEach(() => {
  // 只操作临时目录，绝不碰真实项目文件。
  // 取 realpath：macOS 的 /var 会解析成 /private/var，而服务返回的是解析后的真实路径。
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "mac-manager-files-")))
  source = path.join(root, "source")
  destination = path.join(root, "destination")
  mkdirSync(destination, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("file batch operations", () => {
  it("copies with real byte and entry counts", async () => {
    makeTree()
    const progress: FileOperationProgress[] = []
    const outcome = await runCopyTask({
      paths: [source],
      destPath: destination,
      report: (item) => progress.push(item),
    })

    expect(outcome.partial).toBe(false)
    expect(outcome.result.completed).toEqual([source])
    // 真实字节数：两个文件加起来
    expect(outcome.result.bytes).toBe(30)
    expect(
      readFileSync(path.join(destination, "source", "nested", "b.txt"), "utf8")
    ).toBe("b".repeat(20))

    // 进度只增不减，最后等于真实完成数
    const done = progress.map((item) => item.done)
    expect(done).toEqual([...done].sort((left, right) => left - right))
    expect(done.at(-1)).toBe(2)
    expect(progress.at(-1)?.bytesDone).toBe(30)
    // 复制不预先全盘统计，因此没有分母，也不伪造百分比
    expect(progress.at(-1)?.total).toBeNull()
  })

  it("stages a failed partial file write without publishing it", async () => {
    makeTree()
    let startedCopies = 0
    let activeCopies = 0
    let slowCopyFinished = false
    let releaseCopies!: () => void
    const bothCopiesStarted = new Promise<void>((resolve) => {
      releaseCopies = resolve
    })

    const outcome = await copyEntries([source], destination, {
      io: {
        copyFile: async (from, to, flags) => {
          activeCopies += 1
          startedCopies += 1
          if (startedCopies === 2) releaseCopies()
          await bothCopiesStarted
          try {
            if (path.basename(String(from)) === "a.txt") {
              await copyFileAsync(from, to, flags)
              throw new Error("模拟部分写入失败")
            }
            await new Promise((resolve) => setTimeout(resolve, 10))
            await copyFileAsync(from, to, flags)
            slowCopyFinished = true
          } finally {
            activeCopies -= 1
          }
        },
      },
    })

    expect(outcome.failed).toHaveLength(1)
    expect(slowCopyFinished).toBe(true)
    expect(activeCopies).toBe(0)
    expect(existsSync(path.join(destination, "source"))).toBe(false)
    expect(
      readdirSync(destination).filter((name) =>
        name.endsWith(".operation.part")
      )
    ).toEqual([])
  })

  it("does not overwrite a destination created after the initial check", async () => {
    makeTree()
    const sourceFile = path.join(source, "a.txt")
    const targetFile = path.join(destination, "a.txt")
    const outcome = await copyEntries([sourceFile], destination, {
      io: {
        link: async (staged, target) => {
          writeFileSync(target, "created concurrently")
          await linkAsync(staged, target)
        },
      },
    })

    expect(outcome.failed).toHaveLength(1)
    expect(readFileSync(targetFile, "utf8")).toBe("created concurrently")
    expect(
      readdirSync(destination).filter((name) =>
        name.endsWith(".operation.part")
      )
    ).toEqual([])
  })

  it("limits file copies across the full recursive tree", async () => {
    for (let directory = 0; directory < 6; directory += 1) {
      mkdirSync(source, { recursive: true })
      const nested = path.join(source, `directory-${directory}`)
      mkdirSync(nested)
      for (let file = 0; file < 12; file += 1) {
        writeFileSync(path.join(nested, `${file}.txt`), "data")
      }
    }

    let activeCopies = 0
    let maximumCopies = 0
    const outcome = await copyEntries([source], destination, {
      io: {
        copyFile: async (from, to, flags) => {
          activeCopies += 1
          maximumCopies = Math.max(maximumCopies, activeCopies)
          try {
            await new Promise((resolve) => setTimeout(resolve, 2))
            await copyFileAsync(from, to, flags)
          } finally {
            activeCopies -= 1
          }
        },
      },
    })

    expect(outcome.completed).toEqual([source])
    expect(maximumCopies).toBeGreaterThan(1)
    expect(maximumCopies).toBeLessThanOrEqual(8)
  })

  it("reports a partially removed tree instead of a generic failure", async () => {
    makeTree()
    const firstFile = path.join(source, "a.txt")
    const laterFile = path.join(source, "nested", "b.txt")
    let releaseAfterFirstRemoval!: () => void
    const firstRemoved = new Promise<void>((resolve) => {
      releaseAfterFirstRemoval = resolve
    })

    const outcome = await deleteEntries([source], {
      io: {
        remove: async (target, options) => {
          if (target === laterFile) {
            await firstRemoved
            throw new Error("模拟删除失败")
          }
          await rmAsync(target, options)
        },
      },
      report: (progress) => {
        if (progress.currentTarget === firstFile) releaseAfterFirstRemoval()
      },
    })

    expect(outcome.completed).toEqual([])
    expect(outcome.failed).toEqual([])
    expect(outcome.partial).toHaveLength(1)
    expect(outcome.partial?.[0]?.message).toContain("已移除 1 项")
    expect(existsSync(firstFile)).toBe(false)
    expect(existsSync(laterFile)).toBe(true)
  })

  it("reports a copied destination when cross-volume source removal fails", async () => {
    makeTree()
    const destinationCopy = path.join(destination, "source")
    const outcome = await moveEntries([source], destination, {
      io: {
        rename: async () => {
          const error = new Error("cross-device link") as NodeJS.ErrnoException
          error.code = "EXDEV"
          throw error
        },
        remove: async (target, options) => {
          if (String(target).startsWith(`${source}${path.sep}`)) {
            throw new Error("模拟源删除失败")
          }
          await rmAsync(target, options)
        },
      },
    })

    expect(outcome.completed).toEqual([])
    expect(outcome.failed).toEqual([])
    expect(outcome.partial).toMatchObject([
      {
        path: source,
        destination: destinationCopy,
        message: expect.stringContaining("已复制到目标"),
      },
    ])
    expect(existsSync(source)).toBe(true)
    expect(
      readFileSync(path.join(destinationCopy, "nested", "b.txt"), "utf8")
    ).toBe("b".repeat(20))
    expect(outcome.bytes).toBe(30)
  })

  it("deletes a tree and reports how many entries were really removed", async () => {
    makeTree()
    const progress: FileOperationProgress[] = []
    const outcome = await runDeleteTask({
      paths: [source],
      report: (item) => progress.push(item),
    })

    expect(outcome.partial).toBe(false)
    expect(existsSync(source)).toBe(false)
    expect(progress.at(-1)).toMatchObject({
      done: 2,
      bytesDone: 30,
      stage: "删除中",
    })
  })

  it("records a per-item failure without declaring the whole batch failed", async () => {
    makeTree()
    const missing = path.join(root, "missing")
    const outcome = await runDeleteTask({
      paths: [missing, source],
      report: () => undefined,
    })

    expect(outcome.partial).toBe(true)
    expect(outcome.result.failed).toHaveLength(1)
    expect(outcome.result.failed[0].path).toBe(missing)
    expect(outcome.result.completed).toEqual([source])
    expect(existsSync(source)).toBe(false)
  })

  it("refuses a symbolic link up front instead of following it", async () => {
    makeTree()
    const link = path.join(root, "link")
    symlinkSync(source, link)
    // 校验发生在任何副作用之前：整批直接拒绝，不会复制一半
    await expect(copyEntries([link], destination)).rejects.toThrow(/符号链接/)
    expect(existsSync(path.join(destination, "link"))).toBe(false)
    expect(existsSync(link)).toBe(true)
  })

  it("rejects a destination that is inside the source", async () => {
    makeTree()
    const inside = path.join(source, "nested")
    await expect(copyEntries([source], inside)).rejects.toThrow(
      /自身或其子目录/
    )
  })

  it("only deletes the source after the copy is confirmed when crossing volumes", async () => {
    makeTree()
    const progress: FileOperationProgress[] = []
    const dest = path.join(destination, "source")

    // 模拟跨卷：rename 报 EXDEV，退化成复制后删除
    const outcome = await moveEntries([source], destination, {
      io: {
        rename: async () => {
          const error = new Error("cross-device link") as NodeJS.ErrnoException
          error.code = "EXDEV"
          throw error
        },
      },
      report: (item) => progress.push(item),
    })

    expect(outcome.failed).toEqual([])
    expect(outcome.completed).toEqual([source])
    expect(existsSync(dest)).toBe(true)
    expect(readFileSync(path.join(dest, "nested", "b.txt"), "utf8")).toBe(
      "b".repeat(20)
    )
    // 复制确认后才删除源
    expect(existsSync(source)).toBe(false)
    expect(progress.length).toBeGreaterThan(0)
  })

  it("keeps the source when the cross-volume copy cannot proceed", async () => {
    makeTree()
    // 目的地已有同名条目：跨卷移动必须在这里停下，绝不先删源
    mkdirSync(path.join(destination, "source"), { recursive: true })
    const conflicted = await moveEntries([source], destination, {
      io: {
        rename: async () => {
          const error = new Error("cross-device link") as NodeJS.ErrnoException
          error.code = "EXDEV"
          throw error
        },
      },
    })
    expect(conflicted.failed).toHaveLength(1)
    expect(conflicted.failed[0].message).toContain("目标已存在同名条目")
    // 复制没有成功，源必须完好
    expect(existsSync(path.join(source, "a.txt"))).toBe(true)
    expect(existsSync(path.join(source, "nested", "b.txt"))).toBe(true)
  })

  it("moves a file within the same volume through rename alone", async () => {
    makeTree()
    const outcome = await runMoveTask({
      paths: [path.join(source, "a.txt")],
      destPath: destination,
      report: () => undefined,
    })
    expect(outcome.partial).toBe(false)
    expect(existsSync(path.join(destination, "a.txt"))).toBe(true)
    expect(existsSync(path.join(source, "a.txt"))).toBe(false)
  })
})

describe("file executor wiring", () => {
  it("registers the three batch kinds and rejects malformed payloads", async () => {
    const registry = createExecutorRegistry(taskExecutors)
    for (const kind of [
      TASK_KINDS.fileCopy,
      TASK_KINDS.fileDelete,
      TASK_KINDS.fileMove,
    ]) {
      expect(registry.get(kind)).not.toBeNull()
    }
    await expect(
      registry.get(TASK_KINDS.fileDelete)?.run({}, { report: () => undefined })
    ).rejects.toThrow("删除文件载荷非法")
    await expect(
      registry
        .get(TASK_KINDS.fileCopy)
        ?.run(
          { paths: ["/tmp/a"], shell: "rm -rf /" },
          { report: () => undefined }
        )
    ).rejects.toThrow("复制文件载荷非法")
  })

  it("validates every target before touching anything", async () => {
    makeTree()
    // 有一个目标不存在时整批拒绝：不会先复制一部分再报错
    await expect(
      runCopyTask({
        paths: [source, path.join(root, "missing")],
        destPath: destination,
        report: () => undefined,
      })
    ).rejects.toThrow(/ENOENT|no such file/)
    expect(existsSync(path.join(destination, "source"))).toBe(false)
  })
})

describe("delete safety", () => {
  it("does not follow a symbolic link out of the target tree", async () => {
    makeTree()
    const outside = path.join(root, "outside.txt")
    writeFileSync(outside, "outside")
    symlinkSync(outside, path.join(source, "link"))
    const outcome = await deleteEntries([source])
    expect(outcome.completed).toEqual([source])
    // 链接被删除，但它指向的真实文件必须保留
    expect(existsSync(outside)).toBe(true)
  })
})
