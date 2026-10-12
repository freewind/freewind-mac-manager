import { chmodSync, existsSync, renameSync } from "node:fs"
import path from "node:path"
import { backup, DatabaseSync } from "node:sqlite"
import { closeDatabase, openDatabase } from "@server/database/connection"
import { DATABASE_FILE } from "@server/env"
import type {
  DatabaseBackup,
  DatabaseBackupCreated,
  DatabaseBackupDeleteItem,
  DatabaseBackupDeleteResult,
  DatabaseBackupSource,
  DatabaseBackupsQuery,
  DatabaseBackupsResponse,
  TaskProgress,
} from "@shared/api-contract"
import { DATABASE_BACKUP_DELETE_MAX } from "@shared/api-contract"
import { describeError, formatBytes } from "@shared/format"
import {
  type BackupContentInspection,
  type BackupManifestEntry,
  computeContentSignature,
  dropEntry,
  entryFromFileName,
  findEntry,
  inspectBackupContent,
  loadManifest,
  saveManifest,
  scanBackupDirectory,
  sortEntries,
  toDatabaseBackup,
  upsertEntry,
} from "./catalog"
import {
  allocateBackupFileName,
  assertBackupFileInDirectory,
  BACKUP_FILE_MODE,
  type BackupFileIdentity,
  backupFilePathOf,
  backupFileSize,
  createBackupId,
  currentFileIdentity,
  DatabaseBackupError,
  ensurePrivateDirectory,
  freeBytesAt,
  readTextFileIfExists,
  removeBackupFile,
  removeFileIfExists,
  requiredBytesFor,
  resolveBackupDirectory,
  resolveBackupStateDirectory,
  sameFileIdentity,
  tempFilePathFor,
  writeFileAtomic,
} from "./files"

/**
 * 备份服务：创建原生备份、列出与读取备份、批量删除、以及目录与清单的保守核实。
 *
 * 关键约定：
 * - 备份用 node:sqlite 的原生 `backup()`，只读打开源库并在备份期间固定读事务，
 *   既不直接复制主库文件，也不会漏掉还在 WAL 里的已提交数据。
 * - 先写同目录临时文件，完整性校验与内容签名都通过之后才 rename 发布，
 *   正式文件名下永远不出现半成品。
 * - 清单在发布前就登记（状态 pending），发布后再确认：进程在两步之间被杀掉，
 *   下次核实会把已经落地的文件接管成已发布，不会让备份凭空消失。
 * - 读取（列表、详情）不写清单、不建目录，只有写操作与启动核实才动清单。
 */

/** 原生备份每一步传输的页数；越大越快，进度越粗。 */
export const BACKUP_PAGE_BATCH = 100
/** 进度上报节流：子进程每上报一次就写一行 stdout，不能每页都写。 */
const PROGRESS_THROTTLE_MS = 200
/** 进行中标记文件名：放在维护状态目录，不混进备份产物。 */
const IN_PROGRESS_MARKER_FILE = "in-progress.json"

export type BackupReconcileReport = {
  removedTemporaryFiles: string[]
  /** 清单里有、磁盘上已经没有的条目。 */
  droppedEntries: string[]
  /** 上次没来得及确认发布、本次接管为已发布的条目。 */
  publishedPending: string[]
  /** 目录里有、清单里没有，经核实后接管的备份文件。 */
  adoptedFiles: string[]
  /** 目录里名字合法但核实不通过的文件：不认成备份，也不删除。 */
  unindexedFiles: string[]
  symbolicLinks: string[]
  staleMarker: boolean
}

export type DatabaseBackupService = {
  list: (query: DatabaseBackupsQuery) => DatabaseBackupsResponse
  get: (id: string) => DatabaseBackup | null
  create: (options: {
    source: DatabaseBackupSource
    report?: (progress: TaskProgress) => void
  }) => Promise<DatabaseBackupCreated>
  remove: (options: {
    items: DatabaseBackupDeleteItem[]
    /** 被恢复计划引用等受保护的目标，由调用方传入。 */
    protectedIds?: ReadonlySet<string>
  }) => Promise<DatabaseBackupDeleteResult>
  reconcile: () => Promise<BackupReconcileReport>
}

export type DatabaseBackupServiceOptions = {
  /** 备份目录；默认取 env，测试注入临时目录。 */
  backupDir?: string
  /** 维护状态目录；默认取 env，测试注入临时目录。 */
  stateDir?: string
  /** 被备份的库；默认取 env.DATABASE_FILE。 */
  sourceFile?: string
  now?: () => number
  createId?: () => string
  /** 可用空间查询，测试可注入以模拟磁盘不足。 */
  freeBytes?: (dir: string) => number
  /** 原生备份每步页数，测试可注入。 */
  pageBatch?: number
}

type InProgressMarker = {
  backupId: string
  fileName: string
  startedAt: number
  pid: number
}

const markerFilePath = (stateDir: string): string =>
  path.join(stateDir, IN_PROGRESS_MARKER_FILE)

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    )
  }
}

const readMarker = (stateDir: string): InProgressMarker | null => {
  const text = readTextFileIfExists(markerFilePath(stateDir))
  if (text === null) return null
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== "object" || parsed === null) return null
    const record = parsed as Record<string, unknown>
    const { backupId, fileName, startedAt, pid } = record
    if (
      typeof backupId !== "string" ||
      typeof fileName !== "string" ||
      typeof startedAt !== "number" ||
      typeof pid !== "number"
    ) {
      return null
    }
    return { backupId, fileName, startedAt, pid }
  } catch {
    return null
  }
}

const writeMarker = (stateDir: string, marker: InProgressMarker): void => {
  writeFileAtomic(
    markerFilePath(stateDir),
    `${JSON.stringify(marker)}\n`,
    BACKUP_FILE_MODE
  )
}

const clearMarker = (stateDir: string, backupId: string): void => {
  const marker = readMarker(stateDir)
  // 只清自己的标记：别的进程正在备份时不能把它的标记删掉。
  if (marker !== null && marker.backupId !== backupId) return
  removeFileIfExists(markerFilePath(stateDir))
}

/** 进度上报节流：换阶段必须发一次，因此按阶段与时间双重判断。 */
const createProgressReporter = (
  report?: (progress: TaskProgress) => void
): { report: (progress: TaskProgress, force?: boolean) => void } => {
  let lastAt = 0
  let lastStage: string | null = null
  return {
    report: (progress, force = false) => {
      if (report === undefined) return
      const now = Date.now()
      const stageChanged = progress.stage !== lastStage
      if (!force && !stageChanged && now - lastAt < PROGRESS_THROTTLE_MS) {
        return
      }
      lastAt = now
      lastStage = progress.stage
      report(progress)
    },
  }
}

const toCreateError = (error: unknown): DatabaseBackupError => {
  if (error instanceof DatabaseBackupError) return error
  const code =
    error instanceof Error && "code" in error ? String(error.code) : ""
  if (code === "ENOSPC") {
    return new DatabaseBackupError(
      "too_large",
      "备份过程中磁盘空间不足，已放弃这次备份并清理临时文件"
    )
  }
  if (code === "EACCES" || code === "EPERM") {
    return new DatabaseBackupError(
      "backup_invalid",
      "没有权限写入备份目录，已放弃这次备份"
    )
  }
  return new DatabaseBackupError(
    "backup_invalid",
    `备份失败：${describeError(error)}`
  )
}

/** 源库规模：只读连接读页大小与页数，用于磁盘空间预检与进度换算。 */
const readSourceSize = (
  file: string
): { pageSize: number; pageCount: number; bytes: number } => {
  const database = openDatabase({ file, mode: "readonly" })
  try {
    const sizeRow = database.prepare("PRAGMA page_size").get()
    const countRow = database.prepare("PRAGMA page_count").get()
    const pageSize = Number(sizeRow?.page_size ?? 4096)
    const pageCount = Number(countRow?.page_count ?? 0)
    return { pageSize, pageCount, bytes: pageSize * pageCount }
  } finally {
    closeDatabase(database)
  }
}

/** 把副本整理成自包含单文件：默认还是 WAL 模式，转 DELETE 后不需要旁置文件。 */
const makeSelfContained = (file: string): void => {
  const database = new DatabaseSync(file)
  try {
    const row = database.prepare("PRAGMA journal_mode = DELETE").get()
    if (String(row?.journal_mode ?? "") !== "delete") {
      throw new DatabaseBackupError(
        "backup_invalid",
        "无法把备份整理成自包含文件"
      )
    }
  } finally {
    database.close()
  }
  // 模式切换成功即已 checkpoint；残留的旁置文件（若有）一并清掉。
  removeFileIfExists(`${file}-wal`)
  removeFileIfExists(`${file}-shm`)
}

export const createDatabaseBackupService = (
  options: DatabaseBackupServiceOptions = {}
): DatabaseBackupService => {
  const backupDir = resolveBackupDirectory(options.backupDir)
  const stateDir = resolveBackupStateDirectory(options.stateDir)
  const sourceFile = options.sourceFile ?? DATABASE_FILE
  const now = options.now ?? ((): number => Date.now())
  const createId = options.createId ?? createBackupId
  const freeBytes = options.freeBytes ?? freeBytesAt
  const pageBatch = options.pageBatch ?? BACKUP_PAGE_BATCH

  /** 目录里有、清单里没有的备份文件：核实通过才接管。 */
  const adoptFile = async (
    name: string
  ): Promise<BackupManifestEntry | null> => {
    const file = path.join(backupDir, name)
    let identity: BackupFileIdentity
    try {
      identity = assertBackupFileInDirectory(backupDir, file)
    } catch {
      return null
    }
    const content = inspectBackupContent(file)
    if (!content.integrity.ok || content.structureSignature === null) {
      return null
    }
    let contentSignature: string
    try {
      contentSignature = await computeContentSignature(file)
    } catch {
      return null
    }
    return entryFromFileName({
      name,
      sizeBytes: identity.size,
      identity,
      contentSignature,
      structureSignature: content.structureSignature,
      tableCount: content.tableCount,
      // 清单里没有记录、来源无法追溯：按导入处理，不假装成手工创建。
      source: "import",
    })
  }

  const reconcile = async (): Promise<BackupReconcileReport> => {
    ensurePrivateDirectory(backupDir)
    ensurePrivateDirectory(stateDir)
    const report: BackupReconcileReport = {
      removedTemporaryFiles: [],
      droppedEntries: [],
      publishedPending: [],
      adoptedFiles: [],
      unindexedFiles: [],
      symbolicLinks: [],
      staleMarker: false,
    }
    const scan = scanBackupDirectory(backupDir)
    report.symbolicLinks = scan.symbolicLinks

    // 临时文件是我们自己写的半成品：确认是普通文件后直接清掉。
    for (const name of scan.temporaryFiles) {
      try {
        removeFileIfExists(path.join(backupDir, name))
        report.removedTemporaryFiles.push(name)
      } catch {
        // 删不掉不影响核实结论，留到下次。
      }
    }

    let manifest = loadManifest(backupDir)
    for (const entry of [...manifest.entries]) {
      const file = path.join(backupDir, entry.fileName)
      const current = currentFileIdentity(file)
      if (current === null) {
        manifest = dropEntry(manifest, entry.id)
        report.droppedEntries.push(entry.id)
        continue
      }
      if (entry.status === "pending") {
        // 走到 rename 之前已经校验过完整性：文件在、只是没确认发布，接管为已发布。
        manifest = upsertEntry(manifest, {
          ...entry,
          status: "published",
          sizeBytes: current.size,
          identity: current,
        })
        report.publishedPending.push(entry.id)
      }
    }

    const known = new Set(manifest.entries.map((entry) => entry.fileName))
    for (const item of scan.files) {
      if (known.has(item.name)) continue
      const adopted = await adoptFile(item.name)
      if (adopted === null) {
        report.unindexedFiles.push(item.name)
        continue
      }
      manifest = upsertEntry(manifest, adopted)
      report.adoptedFiles.push(adopted.id)
    }

    const marker = readMarker(stateDir)
    if (marker !== null && !processIsAlive(marker.pid)) {
      removeFileIfExists(markerFilePath(stateDir))
      report.staleMarker = true
    }

    saveManifest(backupDir, manifest)
    return report
  }

  /** 备份文件还在不在：读取只按磁盘现状过滤，不去改清单。 */
  const fileIsPresent = (entry: BackupManifestEntry): boolean =>
    currentFileIdentity(path.join(backupDir, entry.fileName)) !== null

  const list = (query: DatabaseBackupsQuery): DatabaseBackupsResponse => {
    // 读取不建目录、不写清单：目录不存在就是没有备份。
    const manifest = loadManifest(backupDir)
    const backups = sortEntries(manifest.entries)
      .filter((entry) => entry.status === "published")
      .filter(fileIsPresent)
      .filter(
        (entry) => query.source === undefined || entry.source === query.source
      )
      .map((entry) => toDatabaseBackup(backupDir, entry))
    const start = (query.page - 1) * query.pageSize
    return {
      backups: backups.slice(start, start + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: backups.length,
      totalBytes: backups.reduce((sum, backup) => sum + backup.sizeBytes, 0),
      directory: backupDir,
    }
  }

  const get = (id: string): DatabaseBackup | null => {
    const entry = findEntry(loadManifest(backupDir), id)
    if (entry === null || entry.status !== "published") return null
    if (currentFileIdentity(path.join(backupDir, entry.fileName)) === null) {
      return null
    }
    return toDatabaseBackup(backupDir, entry)
  }

  /** 原生备份：只读源连接，靠原生备份自己保证一致性快照。 */
  const runNativeBackup = async (options: {
    temp: string
    fileName: string
    pageSize: number
    report: (progress: TaskProgress, force?: boolean) => void
  }): Promise<void> => {
    const database = openDatabase({ file: sourceFile, mode: "readonly" })
    try {
      // 不在这里开长读事务：实测它拦不住原生备份因其他连接写入而重头再来，
      // 却会卡住 WAL checkpoint。一致性由原生备份自己保证：要么完成，
      // 要么在其他连接写入时重来，绝不给出半截快照。
      const totalPages = await backup(database, options.temp, {
        rate: pageBatch,
        progress: ({ totalPages, remainingPages }) => {
          const pages = Number(totalPages)
          // 其他连接写入时备份会重来，done 因此可能回退：如实上报，不粉饰。
          const done = Math.max(0, pages - Number(remainingPages))
          options.report({
            stage: "备份数据库",
            done,
            total: pages,
            bytesDone: done * options.pageSize,
            bytesTotal: pages * options.pageSize,
            currentTarget: options.fileName,
          })
        },
      })
      // 一次就搬完时原生 backup 不回调进度；用它返回的总页数补一条真实进度。
      const copiedPages = Number(totalPages)
      options.report({
        stage: "备份数据库",
        done: copiedPages,
        total: copiedPages,
        bytesDone: copiedPages * options.pageSize,
        bytesTotal: copiedPages * options.pageSize,
        currentTarget: options.fileName,
      })
    } finally {
      closeDatabase(database)
    }
  }

  const create = async (options2: {
    source: DatabaseBackupSource
    report?: (progress: TaskProgress) => void
  }): Promise<DatabaseBackupCreated> => {
    ensurePrivateDirectory(backupDir)
    ensurePrivateDirectory(stateDir)
    await reconcile()
    const marker = readMarker(stateDir)
    if (marker !== null && processIsAlive(marker.pid)) {
      throw new DatabaseBackupError(
        "backup_invalid",
        "已有备份正在进行，请等它结束"
      )
    }

    const progress = createProgressReporter(options2.report)
    progress.report(
      {
        stage: "准备备份",
        done: 0,
        total: null,
        bytesDone: null,
        bytesTotal: null,
        currentTarget: null,
      },
      true
    )

    let temp: string | null = null
    let id: string | null = null
    try {
      const sourceSize = readSourceSize(sourceFile)
      const required = requiredBytesFor(sourceSize.bytes)
      const available = freeBytes(backupDir)
      if (available < required) {
        throw new DatabaseBackupError(
          "too_large",
          `备份空间不足：需要约 ${formatBytes(required)}，备份目录可用 ${formatBytes(available)}`
        )
      }

      const manifest = loadManifest(backupDir)
      const createdAt = now()
      const allocated = allocateBackupFileName({
        dir: backupDir,
        createdAt,
        takenIds: new Set(manifest.entries.map((entry) => entry.id)),
        createId,
      })
      id = allocated.id
      const backupId = allocated.id
      const fileName = allocated.fileName
      temp = tempFilePathFor(backupDir, fileName)
      const target = backupFilePathOf(backupDir, fileName)
      writeMarker(stateDir, {
        backupId,
        fileName,
        startedAt: createdAt,
        pid: process.pid,
      })

      await runNativeBackup({
        temp,
        fileName,
        pageSize: sourceSize.pageSize,
        report: progress.report,
      })
      progress.report(
        {
          stage: "整理为自包含文件",
          done: sourceSize.pageCount,
          total: sourceSize.pageCount,
          bytesDone: sourceSize.bytes,
          bytesTotal: sourceSize.bytes,
          currentTarget: fileName,
        },
        true
      )
      makeSelfContained(temp)

      progress.report(
        {
          stage: "校验备份完整性",
          done: sourceSize.pageCount,
          total: sourceSize.pageCount,
          bytesDone: sourceSize.bytes,
          bytesTotal: sourceSize.bytes,
          currentTarget: fileName,
        },
        true
      )
      const content: BackupContentInspection = inspectBackupContent(temp)
      if (!content.integrity.ok) {
        throw new DatabaseBackupError(
          "backup_invalid",
          `备份完整性校验未通过：${content.integrity.reason}`
        )
      }
      if (content.structureSignature === null) {
        throw new DatabaseBackupError(
          "backup_invalid",
          "备份完整性校验未通过：读不到结构签名"
        )
      }

      const sizeBytes = backupFileSize(temp) ?? 0
      progress.report(
        {
          stage: "计算内容签名",
          done: sourceSize.pageCount,
          total: sourceSize.pageCount,
          bytesDone: 0,
          bytesTotal: sizeBytes,
          currentTarget: fileName,
        },
        true
      )
      const contentSignature = await computeContentSignature(temp, {
        onBytes: (bytes) => {
          progress.report({
            stage: "计算内容签名",
            done: sourceSize.pageCount,
            total: sourceSize.pageCount,
            bytesDone: bytes,
            bytesTotal: sizeBytes,
            currentTarget: fileName,
          })
        },
      })

      const entry: BackupManifestEntry = {
        id: backupId,
        fileName,
        createdAt,
        sizeBytes,
        source: options2.source,
        contentSignature,
        structureSignature: content.structureSignature,
        tableCount: content.tableCount,
        // 全表计数在 GB 级库上是整表扫描，这里不假填 0，如实给 null。
        rowCount: null,
        originalFileName: null,
        // 先登记再发布：万一进程在两步之间被杀掉，核实流程能接管这个文件。
        status: "pending",
        identity: null,
      }
      saveManifest(backupDir, upsertEntry(manifest, entry))

      progress.report(
        {
          stage: "发布备份",
          done: sourceSize.pageCount,
          total: sourceSize.pageCount,
          bytesDone: sizeBytes,
          bytesTotal: sizeBytes,
          currentTarget: fileName,
        },
        true
      )
      chmodSync(temp, BACKUP_FILE_MODE)
      renameSync(temp, target)
      const identity = currentFileIdentity(target)
      if (identity === null) {
        throw new DatabaseBackupError(
          "backup_invalid",
          "备份文件发布后读不到，请重新核实"
        )
      }
      const published: BackupManifestEntry = {
        ...entry,
        status: "published",
        sizeBytes: identity.size,
        identity,
      }
      try {
        saveManifest(backupDir, upsertEntry(loadManifest(backupDir), published))
      } catch (error) {
        // 文件已经落地且校验通过，清单没写上由下次核实接管，不因此报失败。
        console.warn(
          `[mac-manager] 备份已发布但清单更新失败，将在下次核实时接管：${describeError(error)}`
        )
      }

      progress.report(
        {
          stage: "完成",
          done: 1,
          total: 1,
          bytesDone: identity.size,
          bytesTotal: identity.size,
          currentTarget: fileName,
        },
        true
      )
      return {
        backup: toDatabaseBackup(backupDir, published),
        message: `已创建备份 ${fileName}`,
      }
    } catch (error) {
      // 失败一律不留半成品：临时文件删掉，正式文件名下什么都没发布。
      if (temp !== null) removeFileIfExists(temp)
      throw toCreateError(error)
    } finally {
      if (id !== null) clearMarker(stateDir, id)
    }
  }

  const remove = async (options2: {
    items: DatabaseBackupDeleteItem[]
    protectedIds?: ReadonlySet<string>
  }): Promise<DatabaseBackupDeleteResult> => {
    // 契约限制单次最多 100 条；服务层再拦一次，不依赖调用方一定校验过。
    if (options2.items.length > DATABASE_BACKUP_DELETE_MAX) {
      throw new DatabaseBackupError(
        "backup_invalid",
        `一次最多删除 ${DATABASE_BACKUP_DELETE_MAX} 份备份`
      )
    }
    ensurePrivateDirectory(backupDir)
    ensurePrivateDirectory(stateDir)
    const manifest = loadManifest(backupDir)
    const marker = readMarker(stateDir)
    const deleted: string[] = []
    const failed: { id: string; message: string }[] = []
    const handled = new Set<string>()
    let next = manifest

    for (const item of options2.items) {
      if (handled.has(item.id)) {
        failed.push({ id: item.id, message: "同一个备份 ID 重复出现" })
        continue
      }
      handled.add(item.id)
      const entry = findEntry(manifest, item.id)
      if (entry === null) {
        failed.push({ id: item.id, message: "备份不存在" })
        continue
      }
      if (options2.protectedIds?.has(item.id)) {
        failed.push({ id: item.id, message: "该备份被恢复计划引用，不能删除" })
        continue
      }
      if (marker !== null && marker.backupId === item.id) {
        failed.push({ id: item.id, message: "该备份正在创建中，不能删除" })
        continue
      }
      if (entry.contentSignature !== item.expectedSignature) {
        failed.push({
          id: item.id,
          message: "备份内容与预期签名不一致，已拒绝删除",
        })
        continue
      }
      const file = path.join(backupDir, entry.fileName)
      if (path.resolve(file) === path.resolve(sourceFile)) {
        failed.push({ id: item.id, message: "目标不是备份文件，已拒绝删除" })
        continue
      }
      const current = currentFileIdentity(file)
      if (current === null) {
        failed.push({ id: item.id, message: "备份文件不存在" })
        next = dropEntry(next, item.id)
        continue
      }
      if (
        entry.identity !== null &&
        !sameFileIdentity(entry.identity, current)
      ) {
        failed.push({
          id: item.id,
          message: "备份文件在发布后被改动，已拒绝删除",
        })
        continue
      }
      if (entry.identity === null) {
        // 没有发布时的身份记录（清单被人改过等）：先核实内容与记录一致再删。
        const content = inspectBackupContent(file)
        if (!content.integrity.ok) {
          failed.push({
            id: item.id,
            message: `备份内容无法核实，已拒绝删除：${content.integrity.reason}`,
          })
          continue
        }
        const signature = await computeContentSignature(file)
        if (signature !== entry.contentSignature) {
          failed.push({
            id: item.id,
            message: "备份内容与清单记录不一致，已拒绝删除",
          })
          continue
        }
      }
      try {
        removeBackupFile(backupDir, file, current)
      } catch (error) {
        failed.push({ id: item.id, message: describeError(error) })
        continue
      }
      next = dropEntry(next, item.id)
      deleted.push(item.id)
    }

    saveManifest(backupDir, next)
    return { deleted, failed }
  }

  return { list, get, create, remove, reconcile }
}

/**
 * 启动时的保守核实：只在备份目录已经存在时做一次。
 *
 * 目录还没建过就说明这台机器还没生成过备份，启动时不必替它建目录；
 * 一旦存在，就在这里处理孤儿临时文件、没来得及确认发布的条目、
 * 以及被改坏的清单，避免半成品被当成有效备份、也不让已发布的备份凭空消失。
 */
export const reconcileDatabaseBackupsAtStartup = (): void => {
  const directory = resolveBackupDirectory()
  if (!existsSync(directory)) return
  void (async () => {
    try {
      const report = await createDatabaseBackupService().reconcile()
      const changed =
        report.removedTemporaryFiles.length > 0 ||
        report.droppedEntries.length > 0 ||
        report.publishedPending.length > 0 ||
        report.adoptedFiles.length > 0 ||
        report.unindexedFiles.length > 0 ||
        report.symbolicLinks.length > 0 ||
        report.staleMarker
      if (changed) {
        console.warn(
          `[mac-manager] 启动核实备份目录：${JSON.stringify(report)}`
        )
      }
    } catch (error) {
      console.warn(
        `[mac-manager] 启动核实备份目录失败：${describeError(error)}`
      )
    }
  })()
}
