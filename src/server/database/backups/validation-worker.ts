import {
  BackupValidationJobSchema,
  type BackupValidationMessage,
  validateBackupFileSync,
} from "./validation"

/**
 * 备份校验子进程。
 *
 * 只接受父进程通过 stdin 发来的一条受校验的文件路径（备份目录内的临时文件），
 * 用只读连接做完整性与结构校验，把结论写成一行 JSON。同步 sqlite 会阻塞事件
 * 事件循环，且坏库的完整性检查可能耗时很久，因此校验整体放在一次性子进程里；
 * 父进程据此可以按超时直接终止，不拖累主进程。
 */
const write = (message: BackupValidationMessage): void => {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

const readJob = async (): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString("utf8").trim()
}

const main = async (): Promise<void> => {
  const raw = await readJob()
  if (raw.length === 0) {
    // 父进程在派发前就退出了：这里没有开始任何动作。
    return
  }

  try {
    const parsed = BackupValidationJobSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      write({ type: "failed", error: "备份校验请求不符合约定结构" })
      process.exitCode = 1
      return
    }
    write({ type: "result", result: validateBackupFileSync(parsed.data.file) })
  } catch (error) {
    // 细节只留在服务端日志里；文件不合格的具体原因由校验结果本身给出。
    process.stderr.write(
      `[mac-manager] 备份校验失败：${error instanceof Error ? error.message : "未知错误"}\n`
    )
    write({ type: "failed", error: "备份校验未能完成" })
  }
}

// 父进程消失后写 stdout 会失败；此时不要继续跑。
process.stdout.on("error", () => {
  process.exit(1)
})

void main()
