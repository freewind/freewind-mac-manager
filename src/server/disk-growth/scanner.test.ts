import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { defaultScanConfig, type ScanProgress, scanFileSystem } from "./scanner"

/**
 * 受控替身：fd 只是占位（什么都不输出），xargs 替身忽略输入并打印脚本里写死的
 * stat 格式行。这样就能在不扫描真实磁盘的情况下验证解析、计数与进度。
 */
/** 写成可直接执行的脚本（带 shebang），因为扫描器是把它当可执行文件启动的。 */
const writeStub = (file: string, body: string): void => {
  writeFileSync(file, `#!/usr/bin/env node\n${body}`)
  chmodSync(file, 0o755)
}

const FD_STUB = "process.exit(Number(process.env.STUB_FD_EXIT ?? 0))\n"

let dir: string
let fdPath: string
let xargsPath: string

const writeXargsStub = (lines: string, exitCode = 0): void => {
  writeStub(
    xargsPath,
    `process.stdout.write(${JSON.stringify(lines)})\nprocess.exit(${exitCode})\n`
  )
}

const makeConfig = (root: string) => ({
  ...defaultScanConfig(),
  roots: [root],
  fdBinary: fdPath,
  xargsBinary: xargsPath,
})

const collect = async (root: string): Promise<ScanProgress[]> => {
  const progress: ScanProgress[] = []
  await scanFileSystem(makeConfig(root), (item) => progress.push(item))
  return progress
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mac-manager-scan-"))
  fdPath = path.join(dir, "fd-stub")
  xargsPath = path.join(dir, "xargs-stub")
  writeStub(fdPath, FD_STUB)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const line = (size: number, type: string, target: string): string =>
  `${size}\t${type}\t${target}\n`

describe("scanFileSystem", () => {
  it("counts directories and files and reports real numbers", async () => {
    const root = path.join(dir, "root")
    writeXargsStub(
      line(100, "Directory", `${root}/a`) +
        line(200, "Directory", `${root}/a/b`) +
        line(1024, "Regular File", `${root}/a/one.bin`) +
        line(2048 * 1024, "Regular File", `${root}/a/b/big.bin`) +
        line(10, "Symbolic Link", `${root}/a/link`)
    )

    const progress: ScanProgress[] = []
    const result = await scanFileSystem(makeConfig(root), (item) =>
      progress.push(item)
    )

    expect(result.dirCount).toBe(3)
    expect(result.fileCount).toBe(2)
    expect(result.totalSize).toBe(1024 + 2048 * 1024)
    expect(result.incomplete).toBe(false)
    // 只有超过阈值的文件才单独记录明细
    expect(
      result.entries.filter((entry) => entry.kind === "file").map((e) => e.path)
    ).toEqual([`${root}/a/b/big.bin`])
    // 路径是按父目录聚合的，因此根目录下的合计包含子目录
    expect(result.entries.find((entry) => entry.path === root)?.size).toBe(
      1024 + 2048 * 1024
    )

    // 进度必须是真实数字：只增不减，且最终等于真实结果
    const files = progress.map((item) => item.files)
    expect(files).toEqual([...files].sort((left, right) => left - right))
    expect(files[0]).toBe(0)
    expect(files.at(-1)).toBe(2)
    expect(progress.at(-1)?.stage).toBe("汇总目录")
    expect(progress.at(-1)?.bytes).toBe(1024 + 2048 * 1024)
  })

  it("reassembles a path whose name contains a newline without double counting", async () => {
    const root = path.join(dir, "root")
    // stat 打印 %N 时文件名里的换行会让一条记录被拆成两行
    writeXargsStub(`${line(512, "Regular File", `${root}/weird`)}name.bin`)
    const progress: ScanProgress[] = []
    const result = await scanFileSystem(makeConfig(root), (item) =>
      progress.push(item)
    )
    expect(result.fileCount).toBe(1)
    expect(result.totalSize).toBe(512)
    expect(progress.at(-1)?.files).toBe(1)
  })

  it("stops with an error when the traversal tool fails", async () => {
    const root = path.join(dir, "root")
    writeXargsStub(line(1, "Regular File", `${root}/a`))
    process.env.STUB_FD_EXIT = "1"
    try {
      await expect(collect(root)).rejects.toThrow(/文件遍历失败/)
    } finally {
      delete process.env.STUB_FD_EXIT
    }
  })

  it("refuses to report success when nothing was counted", async () => {
    const root = path.join(dir, "root")
    writeXargsStub("")
    await expect(collect(root)).rejects.toThrow(/没有统计到任何文件/)
  })

  it("marks the result incomplete when some entries could not be read", async () => {
    const root = path.join(dir, "root")
    // stat 对权限不足的文件返回非零，xargs 因此整体退出码非零
    writeXargsStub(line(1024, "Regular File", `${root}/readable.bin`), 123)
    const result = await scanFileSystem(makeConfig(root), () => undefined)
    expect(result.incomplete).toBe(true)
    expect(result.fileCount).toBe(1)
  })

  it("ignores unparsable lines instead of inventing entries", async () => {
    const root = path.join(dir, "root")
    writeXargsStub(
      `${line(1024, "Regular File", `${root}/ok.bin`)}garbage without tabs\n`
    )
    const result = await scanFileSystem(makeConfig(root), () => undefined)
    expect(result.fileCount).toBe(1)
  })
})
