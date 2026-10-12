import type { FileEntry } from "@shared/api-contract"
import { PageHeader } from "@web/components/PageHeader"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@web/components/ui/resizable"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@web/components/ui/sheet"
import type { EntryAction } from "@web/features/files/actions"
import { useFiles } from "@web/features/files/useFiles"
import { useHistoryOverlay } from "@web/hooks/use-history-overlay"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import {
  AlertTriangle,
  Copy,
  Download,
  FilePlus,
  FolderInput,
  FolderPlus,
  FolderTree,
  Pencil,
  Trash2,
} from "lucide-react"
import { useState } from "react"
import { DeleteDialog } from "./DeleteDialog"
import { DirectoryTree } from "./DirectoryTree"
import { EntryNameDialog } from "./EntryNameDialog"
import { FilesToolbar } from "./FilesToolbar"
import { FileTable } from "./FileTable"
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
  // 手机上的目录抽屉；桌面不用它（两套不同时挂载）
  const [treeOpen, setTreeOpen] = useState(false)

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

  // 抽屉也是浮层：系统返回先关抽屉，不直接回退页面
  useHistoryOverlay(treeOpen, () => setTreeOpen(false))

  /** 选目录后关掉抽屉（桌面上没有抽屉，这一句是空操作）。 */
  const navigateFromTree = (path: string): void => {
    model.enterDirectory(path)
    setTreeOpen(false)
  }

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
      icon: FolderPlus,
      disabled: busy,
      run: () => setCreateKind("mkdir"),
    },
    {
      key: "newfile",
      label: "新建文件",
      icon: FilePlus,
      disabled: busy,
      run: () => setCreateKind("newfile"),
    },
    {
      key: "rename",
      label: "重命名",
      icon: Pencil,
      disabled: busy || singleEntry === null,
      run: () => setRenameTarget(singleEntry),
    },
    {
      key: "copy",
      label: "复制到…",
      icon: Copy,
      disabled: busy || noSelection,
      run: () => setTransfer({ mode: "copy", paths: selectedPaths }),
    },
    {
      key: "move",
      label: "移动到…",
      icon: FolderInput,
      disabled: busy || noSelection,
      run: () => setTransfer({ mode: "move", paths: selectedPaths }),
    },
    {
      key: "download",
      label: "下载",
      icon: Download,
      disabled: downloadable === null,
      run: () => {
        if (downloadable !== null) model.downloadEntry(downloadable)
      },
    },
    {
      key: "delete",
      label: "删除",
      icon: Trash2,
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
          run: (name: string) => model.createEntry(createKind, name),
        }
      : renameTarget !== null
        ? {
            title: "重命名",
            description: `当前名称：${renameTarget.name}`,
            confirmText: "重命名",
            initialValue: renameTarget.name,
            run: (name: string) => model.renameEntry(renameTarget.path, name),
          }
        : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <FolderTree className="size-4" />
          <PageHeader title="文件管理" loading={model.isLoading} />
          <div className="ml-auto">
            <FilesToolbar
              model={model}
              onOpenTree={isDesktop ? undefined : () => setTreeOpen(true)}
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
            <AlertTriangle />
            <AlertTitle>读取目录失败</AlertTitle>
            <AlertDescription>
              {model.error instanceof Error
                ? model.error.message
                : String(model.error)}
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {isDesktop ? (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
        >
          <ResizablePanel
            defaultSize="22"
            minSize="12"
            maxSize="45"
            className="min-h-0"
          >
            <DirectoryTree model={model} onNavigate={navigateFromTree} />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel className="min-h-0">
            <FileTable model={model} rowActions={actions} />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <FileTable model={model} rowActions={actions} />
        </div>
      )}

      {/* 手机才挂载抽屉：桌面与手机不会同时渲染两份目录树 */}
      {isDesktop ? null : (
        <Sheet open={treeOpen} onOpenChange={setTreeOpen}>
          <SheetContent side="left" className="w-80 max-w-[85vw] p-0">
            <SheetHeader className="border-b">
              <SheetTitle className="sr-only">目录</SheetTitle>
            </SheetHeader>
            <DirectoryTree model={model} onNavigate={navigateFromTree} />
          </SheetContent>
        </Sheet>
      )}

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
        busy={busy}
        onSubmit={(name) => nameDialog?.run(name) ?? Promise.resolve(false)}
      />

      <DeleteDialog
        open={deletePaths !== null}
        names={model.selectedEntries.map((entry) => entry.name)}
        onOpenChange={(open) => {
          if (!open) setDeletePaths(null)
        }}
        busy={busy}
        onConfirm={() =>
          deletePaths !== null
            ? model.deleteEntries(deletePaths)
            : Promise.resolve(false)
        }
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
        busy={busy}
        onSubmit={(destPath) =>
          transfer !== null
            ? model.transferEntries(transfer.mode, transfer.paths, destPath)
            : Promise.resolve(false)
        }
      />
    </div>
  )
}
