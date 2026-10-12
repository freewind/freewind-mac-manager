import { DATABASE_BACKUP_UPLOAD_MAX_BYTES } from "@shared/api-contract"
import { formatBytes } from "@shared/format"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog"
import { Input } from "@web/components/ui/input"
import { Label } from "@web/components/ui/label"
import { LoaderCircle, Upload } from "lucide-react"
import { useState } from "react"

type BackupImportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  importing: boolean
  /** 返回是否导入成功，成功后由调用方关闭对话框。 */
  onImport: (file: File) => Promise<boolean>
  onCancelImport: () => void
}

/**
 * 导入备份：选文件 → 本地大小预检 → 上传。
 *
 * 客户端预检只是为了少一次往返；服务端仍按 Content-Length 回 413。
 * 上传期间可以取消（AbortSignal），取消后不产生新备份。
 */
export const BackupImportDialog = (props: BackupImportDialogProps) => {
  const { open, onOpenChange, importing, onImport, onCancelImport } = props
  const [file, setFile] = useState<File | null>(null)

  const tooLarge = file !== null && file.size > DATABASE_BACKUP_UPLOAD_MAX_BYTES

  const close = (next: boolean): void => {
    if (!next && importing) return // 上传中不让对话框直接消失，先取消或等结果
    if (!next) setFile(null)
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>导入备份文件</DialogTitle>
          <DialogDescription>
            选中的 .sqlite3
            文件会复制进备份目录并标记为「导入」来源，原文件不会被移动或删除。
            上限 {formatBytes(DATABASE_BACKUP_UPLOAD_MAX_BYTES)}。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="backup-import-file">备份文件</Label>
            <Input
              id="backup-import-file"
              type="file"
              accept=".sqlite3,application/vnd.sqlite3"
              disabled={importing}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>

          {file === null ? null : (
            <p className="text-muted-foreground text-xs">
              已选：{file.name} · {formatBytes(file.size)}
            </p>
          )}

          {tooLarge ? (
            <Alert variant="destructive">
              <AlertTitle>文件超过上限</AlertTitle>
              <AlertDescription>
                {file === null ? "" : formatBytes(file.size)} 超过{" "}
                {formatBytes(DATABASE_BACKUP_UPLOAD_MAX_BYTES)}，不会上传。
              </AlertDescription>
            </Alert>
          ) : null}

          {importing ? (
            <Alert>
              <AlertTitle className="flex items-center gap-2">
                <LoaderCircle className="animate-spin" aria-hidden="true" />
                正在导入
              </AlertTitle>
              <AlertDescription>
                上传进度无法逐段显示（当前用原生 fetch 上传），GB
                级文件按分钟计；中断或失败会提示重新读取列表核实，不会自动重传。
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          {importing ? (
            <Button variant="outline" onClick={onCancelImport}>
              取消上传
            </Button>
          ) : (
            <Button variant="outline" onClick={() => close(false)}>
              取消
            </Button>
          )}
          <Button
            disabled={file === null || tooLarge || importing}
            onClick={() => {
              if (file === null) return
              void onImport(file).then((ok) => {
                if (ok) {
                  setFile(null)
                  onOpenChange(false)
                }
              })
            }}
          >
            <Upload aria-hidden="true" />
            开始导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
