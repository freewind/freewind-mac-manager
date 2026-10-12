import type { DatabaseBackup } from "@shared/api-contract"
import { formatBytes, formatTimestamp } from "@shared/format"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import { Checkbox } from "@web/components/ui/checkbox"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@web/components/ui/empty"
import { Skeleton } from "@web/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@web/components/ui/toggle-group"
import {
  DatabaseBackup as DatabaseBackupIcon,
  Download,
  LoaderCircle,
  Plus,
  RefreshCw,
  Trash,
  Upload,
} from "lucide-react"
import { useState } from "react"
import { BackupImportDialog } from "./BackupImportDialog"
import { DeleteBackupsDialog } from "./DeleteBackupsDialog"
import { DeleteResultAlert } from "./DeleteResultAlert"
import { formatProgress, SOURCE_LABELS } from "./labels"
import { RestorePlanDialog } from "./RestorePlanDialog"
import { RestoreStatusCard } from "./RestoreStatusCard"
import { useBackupActions } from "./useBackupActions"
import {
  type BackupSourceFilter,
  type TransferProgress,
  useBackups,
} from "./useBackups"

const SOURCE_FILTERS: readonly { value: BackupSourceFilter; label: string }[] =
  [
    { value: "all", label: "全部" },
    { value: "manual", label: "手工" },
    { value: "import", label: "导入" },
    { value: "pre_restore", label: "恢复前" },
  ]

/** 规模：尚未统计时如实说「尚未统计」，不显示 0。 */
const formatScale = (backup: DatabaseBackup): string =>
  backup.tableCount === null || backup.rowCount === null
    ? "尚未统计"
    : `${backup.tableCount} 表 / ${backup.rowCount} 行`

/** 不能用于恢复的备份不给恢复入口，但仍可以查看与删除。 */
const restoreBlocked = (backup: DatabaseBackup): boolean =>
  backup.restoreBlockedReason !== null || !backup.integrity.ok

const BackupRow = (props: {
  backup: DatabaseBackup
  selected: boolean
  onToggleSelected: (id: string, next: boolean) => void
  downloadingId: string | null
  downloadProgress: TransferProgress | null
  onDownload: (backup: DatabaseBackup) => void
  onCancelDownload: () => void
  onRestore: (backup: DatabaseBackup) => void
}) => {
  const {
    backup,
    selected,
    onToggleSelected,
    downloadingId,
    downloadProgress,
    onDownload,
    onCancelDownload,
    onRestore,
  } = props
  const downloading = downloadingId === backup.id
  const otherDownloading = downloadingId !== null && !downloading

  return (
    <TableRow className="group" data-state={selected ? "selected" : undefined}>
      <TableCell className="align-top">
        <Checkbox
          aria-label={`选中 ${backup.fileName}`}
          checked={selected}
          onCheckedChange={(checked) =>
            onToggleSelected(backup.id, checked === true)
          }
        />
      </TableCell>
      <TableCell className="max-w-[22rem] align-top">
        <span className="block break-all font-mono text-xs">
          {backup.fileName}
        </span>
        {backup.originalFileName === null ? null : (
          <span className="text-muted-foreground block text-xs">
            导入自 {backup.originalFileName}
          </span>
        )}
      </TableCell>
      <TableCell className="align-top whitespace-nowrap text-xs">
        {formatTimestamp(backup.createdAt / 1000)}
      </TableCell>
      <TableCell className="align-top whitespace-nowrap text-xs">
        {formatBytes(backup.sizeBytes)}
      </TableCell>
      <TableCell className="align-top text-xs">
        {SOURCE_LABELS[backup.source]}
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-col items-start gap-1">
          {backup.integrity.ok ? (
            <Badge variant="secondary">文件完整</Badge>
          ) : (
            <>
              <Badge variant="destructive">文件不完整</Badge>
              <span className="text-muted-foreground text-xs">
                {backup.integrity.reason}
              </span>
            </>
          )}
          {backup.restoreBlockedReason === null ? null : (
            <>
              <Badge variant="outline">不可用于恢复</Badge>
              <span className="text-muted-foreground text-xs">
                {backup.restoreBlockedReason}
              </span>
            </>
          )}
        </div>
      </TableCell>
      <TableCell className="align-top whitespace-nowrap text-xs">
        {formatScale(backup)}
      </TableCell>
      <TableCell className="sticky right-0 z-10 bg-background align-top group-hover:bg-muted/50">
        <div className="flex min-w-max flex-col items-start gap-2">
          {downloading ? (
            <div className="flex flex-col items-start gap-1">
              <Button variant="outline" size="sm" onClick={onCancelDownload}>
                <LoaderCircle className="animate-spin" aria-hidden="true" />
                取消下载
              </Button>
              {downloadProgress === null ? null : (
                <span className="text-muted-foreground text-xs">
                  {formatProgress(downloadProgress)}
                </span>
              )}
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={otherDownloading}
              onClick={() => onDownload(backup)}
            >
              <Download aria-hidden="true" />
              下载
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={restoreBlocked(backup)}
            onClick={() => onRestore(backup)}
          >
            <DatabaseBackupIcon aria-hidden="true" />
            恢复
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

/**
 * 备份视图：列表（分页 + 来源筛选）、创建、导入、下载，以及只读的恢复状态。
 *
 * 危险动作都在确认框里完成：删除逐条列出对象与影响、恢复必须写清「提交不等于
 * 已恢复」并做签名比对；两者提交后都重新读取服务端状态，不做本地假删。
 */
export const BackupsPanel = () => {
  const model = useBackups()
  const actions = useBackupActions({
    backups: model.backups,
    planStatus: model.restore?.plan?.status ?? null,
    refresh: model.refresh,
  })
  const [importOpen, setImportOpen] = useState(false)
  const pageCount = Math.max(1, Math.ceil(model.total / model.pageSize))
  const allSelected =
    model.backups.length > 0 && actions.selected.length === model.backups.length

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-auto">
      <div className="flex flex-col gap-4 p-4">
        <RestoreStatusCard
          state={model.restore}
          loading={model.restoreLoading}
          error={model.restoreError}
          action={
            actions.canCancelPlan ? (
              <Button
                variant="outline"
                size="sm"
                disabled={actions.busy !== null}
                onClick={() => void actions.cancelPlan()}
              >
                {actions.busy === "cancel" ? "正在取消…" : "取消恢复计划"}
              </Button>
            ) : undefined
          }
        />

        {actions.cancelNotice === null ? null : (
          <Alert variant="destructive">
            <AlertTitle>取消恢复计划没有成功</AlertTitle>
            <AlertDescription>{actions.cancelNotice}</AlertDescription>
          </Alert>
        )}

        {actions.cancelUnknown === null ? null : (
          <Alert>
            <AlertTitle>结果未知</AlertTitle>
            <AlertDescription className="space-y-2">
              <span>{actions.cancelUnknown}</span>
              <span className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => void actions.verify()}
                >
                  重新读取核实
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-11"
                  onClick={actions.dismissUnknown}
                >
                  已核对，继续
                </Button>
              </span>
            </AlertDescription>
          </Alert>
        )}

        {actions.deleteOutcome === null ? null : (
          <DeleteResultAlert
            outcome={actions.deleteOutcome}
            onDismiss={actions.dismissDeleteOutcome}
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={model.createBusy}
            onClick={() => void model.createBackup()}
          >
            {model.createBusy ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            创建备份
          </Button>
          <Button
            variant="outline"
            disabled={model.importing}
            onClick={() => setImportOpen(true)}
          >
            <Upload aria-hidden="true" />
            导入备份
          </Button>
          {model.importing ? (
            <span className="flex items-center gap-2 text-xs">
              <LoaderCircle
                className="animate-spin"
                aria-hidden="true"
                size={14}
              />
              正在导入备份…
              {model.importProgress === null
                ? null
                : formatProgress(model.importProgress)}
              <Button variant="ghost" size="sm" onClick={model.cancelImport}>
                取消导入
              </Button>
            </span>
          ) : null}

          <ToggleGroup
            variant="outline"
            className="flex-wrap"
            value={[model.source]}
            onValueChange={(values) => {
              const next = values[0]
              if (next) model.setSource(next as BackupSourceFilter)
            }}
          >
            {SOURCE_FILTERS.map((item) => (
              <ToggleGroupItem
                key={item.value}
                value={item.value}
                className="min-h-11 px-3"
              >
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <Button
            variant="outline"
            onClick={() => void model.refresh()}
            disabled={model.listLoading}
          >
            <RefreshCw aria-hidden="true" />
            刷新
          </Button>

          <span className="text-muted-foreground ml-auto text-xs">
            共 {model.total} 份 · 占用 {formatBytes(model.totalBytes)}
            {model.directory === null ? "" : ` · ${model.directory}`}
          </span>
        </div>

        {actions.selected.length === 0 ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="destructive"
              disabled={actions.busy !== null}
              onClick={actions.openDelete}
            >
              <Trash aria-hidden="true" />
              删除选中的 {actions.selected.length} 份
            </Button>
            <Button variant="ghost" size="sm" onClick={actions.clearSelection}>
              清除选择
            </Button>
          </div>
        )}

        {model.listError === null ? null : (
          <Alert variant="destructive">
            <AlertTitle>备份列表读取失败</AlertTitle>
            <AlertDescription>{model.listError}</AlertDescription>
          </Alert>
        )}

        {model.listLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : model.listError !== null ? null : model.backups.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>还没有备份</EmptyTitle>
              <EmptyDescription>
                用「创建备份」生成一份当前数据库的快照，或者导入已有的 .sqlite3
                备份文件。备份按创建时间倒序显示。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                {/* 选择与短标记列给宽度基准；文件名、创建时间内容不固定，不给 nowrap */}
                <TableHead className="w-[1%] whitespace-nowrap">
                  <Checkbox
                    aria-label="选中当前页全部备份"
                    checked={allSelected}
                    onCheckedChange={(checked) =>
                      checked === true
                        ? actions.selectAll()
                        : actions.clearSelection()
                    }
                  />
                </TableHead>
                <TableHead>文件名</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="w-[1%] whitespace-nowrap">大小</TableHead>
                <TableHead className="w-[1%] whitespace-nowrap">来源</TableHead>
                <TableHead className="w-[1%] whitespace-nowrap">状态</TableHead>
                <TableHead className="w-[1%] whitespace-nowrap">规模</TableHead>
                <TableHead className="sticky right-0 z-10 w-[1%] whitespace-nowrap bg-background">
                  操作
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {model.backups.map((backup) => (
                <BackupRow
                  key={backup.id}
                  backup={backup}
                  selected={actions.selectedIds.includes(backup.id)}
                  onToggleSelected={actions.toggleSelected}
                  downloadingId={model.downloadingId}
                  downloadProgress={model.downloadProgress}
                  onDownload={(item) => void model.download(item)}
                  onCancelDownload={model.cancelDownload}
                  onRestore={actions.openRestore}
                />
              ))}
            </TableBody>
          </Table>
        )}

        {pageCount <= 1 ? null : (
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={model.page <= 1}
              onClick={() => model.setPage(model.page - 1)}
            >
              上一页
            </Button>
            <span className="text-xs">
              第 {model.page} / {pageCount} 页
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={model.page >= pageCount}
              onClick={() => model.setPage(model.page + 1)}
            >
              下一页
            </Button>
          </div>
        )}

        <p className="text-muted-foreground text-xs">
          下载会把整个文件流式发送到本机浏览器，GB
          级文件按分钟计，随时可以取消；取消或失败都不会影响备份文件本身。
        </p>
      </div>

      <BackupImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        importing={model.importing}
        progress={model.importProgress}
        onImport={model.importBackup}
        onCancelImport={model.cancelImport}
      />

      <DeleteBackupsDialog
        open={actions.deleteDialogOpen}
        onOpenChange={actions.setDeleteDialogOpen}
        targets={actions.selected}
        busy={actions.busy === "delete"}
        failure={actions.deleteFailure}
        unknownNotice={actions.deleteUnknown}
        onVerify={() => void actions.verify()}
        onDismissUnknown={actions.dismissUnknown}
        onConfirm={() => void actions.confirmDelete()}
      />

      <RestorePlanDialog
        open={actions.restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open) actions.closeRestore()
        }}
        backup={actions.restoreTarget}
        currentSignature={model.restore?.currentSignature ?? null}
        busy={actions.busy === "restore"}
        failure={actions.restoreFailure}
        unknownNotice={actions.restoreUnknown}
        backupCurrent={actions.backupCurrent}
        onBackupCurrentChange={actions.setBackupCurrent}
        onVerify={() => void actions.verify()}
        onDismissUnknown={actions.dismissUnknown}
        onConfirm={() => void actions.confirmRestore()}
      />
    </div>
  )
}
