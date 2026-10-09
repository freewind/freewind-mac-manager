import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  Copy01Icon,
  Download01Icon,
  FileAddIcon,
  FolderAddIcon,
  FolderShared01Icon,
  FolderTransferIcon,
  PencilEdit01Icon,
  TrashIcon,
} from "@hugeicons/core-free-icons"
import { useState } from "react"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import type { FileEntry } from "@shared/api-contract"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@web/components/ui/resizable"
import type { EntryAction } from "@web/features/files/actions"
import { useFiles } from "@web/features/files/useFiles"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { DeleteDialog } from "./DeleteDialog"
import { DirectoryTree } from "./DirectoryTree"
import { EntryNameDialog } from "./EntryNameDialog"
import { FileTable } from "./FileTable"
import { FilesToolbar } from "./FilesToolbar"
import { MoveDialog } from "./MoveDialog"
import { PathBreadcrumb } from "./PathBreadcrumb"

type TransferState = {
  mode: "copy" | "move"
  paths: string[]
}

export const FilesPage = () => {
  const model = useFiles()
  const isDesktop = useIsDesktop()
  const [createKind, setCreateKind] = useState<"mkdir" | "newfile" | null>(null)
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null)
  const [deletePaths, setDeletePaths] = useState<string[] | null>(null)
  const [transfer, setTransfer] = useState<TransferState | null>(null)

  useHistoryOverlay(
    createKind !== null ||
      renameTarget !== null ||
      deletePaths !== null ||
      transfer !== null,
    () => {
      setCreateKind(null)
      setRenameTarget(null)
      setDeletePaths(null)
      setTransfer(null)
    }
  )

  // 动作只针对当前目录里确实存在的条目，避免选择里残留的旧路径被当成目标
  const selectedPaths = model.selectedEntries.map((entry) => entry.path)
  const singleEntry =
    model.selectedEntries.length === 1 ? model.selectedEntries[0] : null
  const downloadable = singleEntry?.kind === "file" ? singleEntry : null
  const busy = model.isMutating
  const noSelection = selectedPaths.length === 0

  const actions: EntryAction[] = [
    {
      key: "mkdir",
      label: "新建文件夹",
      icon: FolderAddIcon,
      disabled: busy,
      run: () => setCreateKind("mkdir"),
    },
    {
      key: "newfile",
      label: "新建文件",
      icon: FileAddIcon,
      disabled: busy,
      run: () => setCreateKind("newfile"),
    },
    {
      key: "rename",
      label: "重命名",
      icon: PencilEdit01Icon,
      disabled: busy || singleEntry === null,
      run: () => setRenameTarget(singleEntry),
    },
    {
      key: "copy",
      label: "复制到…",
      icon: Copy01Icon,
      disabled: busy || noSelection,
      run: () => setTransfer({ mode: "copy", paths: selectedPaths }),
    },
    {
      key: "move",
      label: "移动到…",
      icon: FolderTransferIcon,
      disabled: busy || noSelection,
      run: () => setTransfer({ mode: "move", paths: selectedPaths }),
    },
    {
      key: "download",
      label: "下载",
      icon: Download01Icon,
      disabled: downloadable === null,
      run: () => {
        if (downloadable !== null) model.downloadEntry(downloadable)
      },
    },
    {
      key: "delete",
      label: "删除",
      icon: TrashIcon,
      destructive: true,
      disabled: busy || noSelection,
      run: () => setDeletePaths(selectedPaths),
    },
  ]

  const [newFolderAction, newFileAction, ...rowActions] = actions

  const nameDialog =
    createKind !== null
      ? {
          title: createKind === "mkdir" ? "新建文件夹" : "新建文件",
          description: `将在 ${model.currentPath} 下创建`,
          confirmText: "创建",
          initialValue: "",
          run: (name: string) => {
            void model.createEntry(createKind, name)
          },
        }
      : renameTarget !== null
        ? {
            title: "重命名",
            description: `当前名称：${renameTarget.name}`,
            confirmText: "重命名",
            initialValue: renameTarget.name,
            run: (name: string) => {
              void model.renameEntry(renameTarget.path, name)
            },
          }
        : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <HugeiconsIcon icon={FolderShared01Icon} className="size-4" />
          <h1 className="text-sm font-medium">文件管理</h1>
          <div className="ml-auto">
            <FilesToolbar
              model={model}
              primaryActions={
                newFolderAction && newFileAction
                  ? [newFolderAction, newFileAction]
                  : []
              }
              menuActions={rowActions}
            />
          </div>
        </div>
        <PathBreadcrumb
          crumbs={model.crumbs}
          onNavigate={model.enterDirectory}
        />
      </header>

      {model.error ? (
        <div className="px-4 py-3">
          <Alert variant="destructive">
            <HugeiconsIcon icon={Alert02Icon} />
            <AlertTitle>读取目录失败</AlertTitle>
            <AlertDescription>
              {model.error instanceof Error
                ? model.error.message
                : String(model.error)}
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      <ResizablePanelGroup
        orientation={isDesktop ? "horizontal" : "vertical"}
        className="min-h-0 flex-1"
      >
        <ResizablePanel
          defaultSize={22}
          minSize={12}
          maxSize={45}
          className="min-h-0"
        >
          <DirectoryTree model={model} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel className="min-h-0">
          <FileTable model={model} rowActions={actions} />
        </ResizablePanel>
      </ResizablePanelGroup>

      <EntryNameDialog
        open={nameDialog !== null}
        title={nameDialog?.title ?? ""}
        description={nameDialog?.description ?? ""}
        confirmText={nameDialog?.confirmText ?? ""}
        initialValue={nameDialog?.initialValue ?? ""}
        onOpenChange={(open) => {
          if (!open) {
            setCreateKind(null)
            setRenameTarget(null)
          }
        }}
        onSubmit={(name) => nameDialog?.run(name)}
      />

      <DeleteDialog
        open={deletePaths !== null}
        names={model.selectedEntries.map((entry) => entry.name)}
        onOpenChange={(open) => {
          if (!open) setDeletePaths(null)
        }}
        onConfirm={() => {
          if (deletePaths !== null) void model.deleteEntries(deletePaths)
        }}
      />

      <MoveDialog
        open={transfer !== null}
        mode={transfer?.mode ?? "copy"}
        rootPath={model.rootPath}
        startPath={model.currentPath}
        names={model.selectedEntries.map((entry) => entry.name)}
        onOpenChange={(open) => {
          if (!open) setTransfer(null)
        }}
        onSubmit={(destPath) => {
          if (transfer !== null) {
            void model.transferEntries(transfer.mode, transfer.paths, destPath)
          }
        }}
      />
    </div>
  )
}
