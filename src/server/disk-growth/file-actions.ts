import { execFile } from "node:child_process"
import { existsSync, renameSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

const TRASH_DIR = path.join(homedir(), ".Trash")

const run = (command: string, args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile(command, args, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })

const assertExists = (target: string): void => {
  if (!path.isAbsolute(target)) {
    throw new Error("路径必须是绝对路径")
  }
  if (!existsSync(target)) {
    throw new Error(`路径不存在：${target}`)
  }
}

/** 在访达中定位该文件或目录。 */
export const revealInFinder = async (target: string): Promise<string> => {
  assertExists(target)
  await run("/usr/bin/open", ["-R", target])
  return `已在访达中显示：${target}`
}

/** 移到废纸篓（同名时追加时间戳，避免覆盖）。 */
export const moveToTrash = async (target: string): Promise<string> => {
  assertExists(target)
  if (target.startsWith(`${TRASH_DIR}/`) || target === TRASH_DIR) {
    throw new Error("该路径已在废纸篓中")
  }
  let destination = path.join(TRASH_DIR, path.basename(target))
  if (existsSync(destination)) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)
    destination = path.join(TRASH_DIR, `${stamp}-${path.basename(target)}`)
  }
  const isDirectory = statSync(target).isDirectory()
  renameSync(target, destination)
  return `已移到废纸篓：${target}${isDirectory ? "（目录）" : ""}`
}
