import { readdir } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type { ServiceDomain } from "@shared/api-contract"

/** 扫描范围：用户级、全局（系统目录里的 LaunchAgents）与系统级守护进程。 */
export type ServiceDirectory = {
  domain: ServiceDomain
  directory: string
  requiresRoot: boolean
}

export const SERVICE_DIRECTORIES: ServiceDirectory[] = [
  {
    domain: "user",
    directory: path.join(homedir(), "Library/LaunchAgents"),
    requiresRoot: false,
  },
  {
    domain: "global",
    directory: "/Library/LaunchAgents",
    requiresRoot: true,
  },
  {
    domain: "system",
    directory: "/Library/LaunchDaemons",
    requiresRoot: true,
  },
]

export const directoryOf = (domain: ServiceDomain): ServiceDirectory => {
  const found = SERVICE_DIRECTORIES.find((item) => item.domain === domain)
  if (!found) {
    throw new Error(`未知的服务域：${domain}`)
  }
  return found
}

/** 列出目录里的 plist 文件名（目录不存在或无权限时返回空）。 */
export const listPlistFiles = async (directory: string): Promise<string[]> => {
  try {
    const names = await readdir(directory)
    return names.filter((name) => name.endsWith(".plist")).sort()
  } catch {
    return []
  }
}
