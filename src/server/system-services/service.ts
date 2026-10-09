import { existsSync } from "node:fs"
import path from "node:path"
import { moveToTrash, revealInFinder } from "@server/common/file-actions"
import type {
  ServiceDomain,
  ServiceState,
  ServicesResponse,
  SystemService,
} from "@shared/api-contract"
import {
  bootstrapPlist,
  bootoutPlist,
  kickstart,
  kickstartRestart,
  readDisabledMap,
  readRuntime,
  setEnabled,
  terminate,
} from "./launchctl"
import { readPlistJson, readPlistText, toPlistFields } from "./plist"
import { directoryOf, listPlistFiles, SERVICE_DIRECTORIES } from "./scanner"

/** 需要 root 才能改动的服务，操作时据此回 403。 */
export class RootRequiredError extends Error {}

export type ServiceTarget = {
  label: string
  domain: ServiceDomain
}

const stateOf = (input: {
  loaded: boolean
  running: boolean
  disabled: boolean
  lastExitCode: number | null
}): ServiceState => {
  if (input.disabled) return "disabled"
  if (input.running) return "running"
  if (input.loaded && input.lastExitCode !== null && input.lastExitCode !== 0) {
    return "failed"
  }
  return "stopped"
}

/** 扫描三个目录，解析每个 plist 的元数据并补上运行时状态。 */
export const listSystemServices = async (): Promise<ServicesResponse> => {
  const services: SystemService[] = []
  const skipped: { path: string; reason: string }[] = []

  for (const entry of SERVICE_DIRECTORIES) {
    const files = await listPlistFiles(entry.directory)
    if (files.length === 0) continue
    const disabledMap = await readDisabledMap(entry.domain)

    for (const name of files) {
      const filePath = path.join(entry.directory, name)
      try {
        const [plist, json] = await Promise.all([
          readPlistText(filePath),
          readPlistJson(filePath),
        ])
        const fields = toPlistFields(json)
        const label = fields.label ?? name.replace(/\.plist$/, "")
        const runtime = await readRuntime(entry.domain, label)
        const disabled = disabledMap.get(label) ?? false
        services.push({
          label,
          domain: entry.domain,
          filePath,
          exists: true,
          loaded: runtime.loaded,
          disabled,
          state: stateOf({
            loaded: runtime.loaded,
            running: runtime.running,
            disabled,
            lastExitCode: runtime.lastExitCode,
          }),
          pid: runtime.pid,
          lastExitCode: runtime.lastExitCode,
          // launchctl print 不提供启动时间，这里如实留空。
          startedAt: null,
          program: fields.program,
          args: fields.args,
          runAtLoad: fields.runAtLoad,
          keepAlive: fields.keepAlive,
          startInterval: fields.startInterval,
          workingDirectory: fields.workingDirectory,
          stdoutPath: fields.stdoutPath,
          stderrPath: fields.stderrPath,
          environment: fields.environment,
          processType: fields.processType,
          throttleInterval: fields.throttleInterval,
          requiresRoot: entry.requiresRoot,
          plist,
        })
      } catch (error) {
        skipped.push({
          path: filePath,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  services.sort((left, right) => left.label.localeCompare(right.label))
  return { services, skipped }
}

/** 定位服务的 plist，并挡住需要 root 的服务。 */
const locate = (target: ServiceTarget): { directory: string; file: string } => {
  const entry = directoryOf(target.domain)
  if (entry.requiresRoot) {
    throw new RootRequiredError(
      `${target.label} 位于 ${entry.directory}，需要 root 权限；这里只提供查看与复制。`
    )
  }
  return {
    directory: entry.directory,
    file: path.join(entry.directory, `${target.label}.plist`),
  }
}

export const startService = async (target: ServiceTarget): Promise<string> => {
  const { file } = locate(target)
  const runtime = await readRuntime(target.domain, target.label)
  if (!runtime.loaded) {
    if (!existsSync(file)) {
      throw new Error(`找不到 plist 文件：${file}`)
    }
    await bootstrapPlist(target.domain, file)
  }
  await kickstart(target.domain, target.label)
  return `已启动 ${target.label}`
}

export const stopService = async (target: ServiceTarget): Promise<string> => {
  locate(target)
  await terminate(target.domain, target.label)
  return `已停止 ${target.label}（若 KeepAlive 为真，launchd 会再次拉起）`
}

export const restartService = async (
  target: ServiceTarget
): Promise<string> => {
  locate(target)
  await kickstartRestart(target.domain, target.label)
  return `已重启 ${target.label}`
}

export const loadService = async (target: ServiceTarget): Promise<string> => {
  const { file } = locate(target)
  if (!existsSync(file)) {
    throw new Error(`找不到 plist 文件：${file}`)
  }
  // 先 bootout 清掉残留，再 bootstrap，避免「service already loaded」。
  try {
    await bootoutPlist(target.domain, file)
  } catch {
    // 未加载时 bootout 会失败，忽略。
  }
  await bootstrapPlist(target.domain, file)
  await setEnabled(target.domain, target.label, true)
  await kickstart(target.domain, target.label)
  return `已加载并启动 ${target.label}`
}

export const uninstallService = async (
  target: ServiceTarget
): Promise<string> => {
  const { file } = locate(target)
  if (!existsSync(file)) {
    throw new Error(`plist 已不在原处：${file}`)
  }
  try {
    await bootoutPlist(target.domain, file)
  } catch {
    // 未加载时 bootout 会失败，不影响卸载。
  }
  const message = await moveToTrash(file)
  return `已卸载 ${target.label}：${message}`
}

export const setServiceEnabled = async (
  target: ServiceTarget & { disabled: boolean }
): Promise<string> => {
  locate(target)
  await setEnabled(target.domain, target.label, !target.disabled)
  return target.disabled
    ? `已禁用 ${target.label}，开机不再自动启动`
    : `已启用 ${target.label}`
}

export const revealService = async (target: ServiceTarget): Promise<string> => {
  const { file } = locate(target)
  return revealInFinder(file)
}
