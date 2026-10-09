import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  FolderShared01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Button } from "@web/components/ui/button"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@web/components/ui/resizable"
import { useFiles } from "@web/features/files/useFiles"
import { DirectoryTree } from "./DirectoryTree"
import { FileTable } from "./FileTable"
import { PathBreadcrumb } from "./PathBreadcrumb"

export const FilesPage = () => {
  const model = useFiles()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <HugeiconsIcon icon={FolderShared01Icon} className="size-4" />
          <h1 className="text-sm font-medium">文件管理</h1>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={model.refresh}>
              <HugeiconsIcon icon={RefreshIcon} />
              刷新
            </Button>
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

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
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
          <FileTable model={model} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
