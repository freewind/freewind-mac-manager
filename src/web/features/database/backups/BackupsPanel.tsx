import type { DatabaseBackup, DatabaseBackupSource } from "@shared/api-contract"
import { formatBytes, formatTimestamp } from "@shared/format"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
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
import { Download, LoaderCircle, Plus, RefreshCw, Upload } from "lucide-react"
import { useState } from "react"
import { BackupImportDialog } from "./BackupImportDialog"
import { RestoreStatusCard } from "./RestoreStatusCard"
import { type BackupSourceFilter, useBackups } from "./useBackups"

const SOURCE_LABELS: Record<DatabaseBackupSource, string> = {
  manual: "手工创建",
  import: "导入",
  pre_restore: "恢复前自动",
}

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

const BackupRow = (props: {
  backup: DatabaseBackup
  downloadingId: string | null
  onDownload: (backup: DatabaseBackup) => void
  onCancelDownload: () => void
}) => {
  const { backup, downloadingId, onDownload, onCancelDownload } = props
  const downloading = downloadingId === backup.id
  const otherDownloading = downloadingId !== null && !downloading

  return (
    <TableRow>
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
      <TableCell className="align-top">
        {downloading ? (
          <Button variant="outline" size="sm" onClick={onCancelDownload}>
            <LoaderCircle className="animate-spin" aria-hidden="true" />
            取消下载
          </Button>
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
      </TableCell>
    </TableRow>
  )
}

/**
 * 备份视图：列表（分页 + 来源筛选）、创建、导入、下载，以及只读的恢复状态。
 *
 * 页面主体滚动交给这里的唯一容器，头部工具区不滚动，符合整页只有一个纵向
 * 滚动区的约定。恢复的确认与提交、备份删除都不在本视图内。
 */
export const BackupsPanel = () => {
  const model = useBackups()
  const [importOpen, setImportOpen] = useState(false)
  const pageCount = Math.max(1, Math.ceil(model.total / model.pageSize))

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-auto">
      <div className="flex flex-col gap-4 p-4">
        <RestoreStatusCard
          state={model.restore}
          loading={model.restoreLoading}
          error={model.restoreError}
        />

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
            <TableHeader>
              <TableRow>
                <TableHead>文件名</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>大小</TableHead>
                <TableHead>来源</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>规模</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {model.backups.map((backup) => (
                <BackupRow
                  key={backup.id}
                  backup={backup}
                  downloadingId={model.downloadingId}
                  onDownload={(item) => void model.download(item)}
                  onCancelDownload={model.cancelDownload}
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
          下载会把整个文件流式发送到本机浏览器（当前无法逐段显示进度，GB
          级文件按分钟计），随时可以取消；取消或失败都不会影响备份文件本身。
        </p>
      </div>

      <BackupImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        importing={model.importing}
        onImport={model.importBackup}
        onCancelImport={model.cancelImport}
      />
    </div>
  )
}
