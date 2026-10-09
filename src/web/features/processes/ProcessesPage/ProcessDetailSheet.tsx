import { HugeiconsIcon } from "@hugeicons/react"
import { InformationCircleIcon, LockIcon } from "@hugeicons/core-free-icons"
import type { ReactNode } from "react"
import { formatBytes } from "@shared/format"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@web/components/ui/item"
import { Progress } from "@web/components/ui/progress"
import { ScrollArea } from "@web/components/ui/scroll-area"
import { Separator } from "@web/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@web/components/ui/sheet"
import { cn } from "@web/lib/utils"
import {
  formatDuration,
  PROCESS_KIND_LABEL,
  PROCESS_STATE_LABEL,
  PROCESS_STATE_VARIANT,
  toPercent,
} from "@web/features/processes/display"
import type { ProcessEntry } from "@shared/api-contract"
import { ProcessAvatar } from "@web/features/processes/ProcessesPage/ProcessAvatar"
import type { useProcesses } from "@web/features/processes/useProcesses"

type ProcessDetailSheetProps = {
  model: ReturnType<typeof useProcesses>
  onRequestTerminate: (items: ProcessEntry[], force: boolean) => void
}

/** 选中进程的详情抽屉：资源占用、进程信息与子进程。 */
export const ProcessDetailSheet = (props: ProcessDetailSheetProps) => {
  const { model, onRequestTerminate } = props
  const selected =
    model.processes.find((item) => item.pid === model.selectedPid) ?? null
  const parent =
    selected === null
      ? null
      : (model.processes.find((item) => item.pid === selected.ppid) ?? null)
  const children =
    selected === null
      ? []
      : model.processes.filter((item) => item.ppid === selected.pid)
  const ownedByCurrentUser = selected !== null && selected.user === model.currentUser

  return (
    <Sheet
      open={selected !== null}
      onOpenChange={(open) => {
        if (!open) model.selectProcess(null)
      }}
    >
      <SheetContent className="gap-0 p-0 sm:max-w-md">
        {selected !== null ? (
          <>
            <SheetHeader className="gap-2 border-b p-5">
              <div className="flex items-center gap-2.5">
                <ProcessAvatar name={selected.name} size="lg" className="rounded-lg" />
                <div className="flex min-w-0 flex-col gap-1">
                  <SheetTitle className="truncate">{selected.name}</SheetTitle>
                  <SheetDescription className="flex items-center gap-1.5">
                    <span>PID {selected.pid}</span>
                    <span>·</span>
                    <span>{PROCESS_KIND_LABEL[selected.kind]}</span>
                    <span>·</span>
                    <span>{selected.user}</span>
                  </SheetDescription>
                </div>
                <Badge
                  variant={PROCESS_STATE_VARIANT[selected.state]}
                  className="ml-auto"
                >
                  {PROCESS_STATE_LABEL[selected.state]}
                </Badge>
              </div>
              <code className="mt-1 block rounded-md bg-muted/60 px-2 py-1.5 text-[0.6875rem] break-all text-muted-foreground">
                {selected.command}
              </code>
            </SheetHeader>

            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-4 p-5">
                <section className="flex flex-col gap-1">
                  <SectionTitle>资源占用</SectionTitle>
                  <DetailRow label="CPU">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "w-12 tabular-nums",
                          selected.cpu >= 20 ? "text-destructive" : undefined
                        )}
                      >
                        {selected.cpu.toFixed(1)}%
                      </span>
                      <Progress
                        value={toPercent(selected.cpu / 100)}
                        className="w-24"
                      />
                    </span>
                  </DetailRow>
                  <DetailRow label="内存">
                    <span className="flex items-center gap-2">
                      <span className="w-16 tabular-nums">
                        {formatBytes(selected.memoryBytes)}
                      </span>
                      <Progress
                        value={toPercent(
                          selected.memoryBytes / model.peakMemoryBytes
                        )}
                        className="w-24"
                      />
                    </span>
                  </DetailRow>
                  <DetailRow label="线程">
                    {selected.threads ?? "—"}
                  </DetailRow>
                </section>

                <Separator />

                <section className="flex flex-col gap-1">
                  <SectionTitle>进程信息</SectionTitle>
                  <DetailRow label="父进程">
                    {parent === null ? (
                      <span className="text-muted-foreground">
                        {selected.ppid}（已退出）
                      </span>
                    ) : (
                      <Button
                        variant="link"
                        size="xs"
                        className="h-4 px-0"
                        onClick={() => model.selectProcess(parent.pid)}
                      >
                        {parent.name}（{parent.pid}）
                      </Button>
                    )}
                  </DetailRow>
                  <DetailRow label="启动于">
                    {new Date(selected.startedAt * 1000).toLocaleString("zh-CN")}
                  </DetailRow>
                  <DetailRow label="已运行">
                    {formatDuration(model.nowMs / 1000 - selected.startedAt)}
                  </DetailRow>
                  <DetailRow label="可执行文件">
                    <code className="text-[0.6875rem]">{selected.path}</code>
                  </DetailRow>
                  <DetailRow label="监听端口">
                    {selected.ports.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {selected.ports.map((port) => (
                          <Badge key={port} variant="outline">
                            :{port}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </DetailRow>
                </section>

                <Separator />

                <section className="flex flex-col gap-2">
                  <SectionTitle>子进程（{children.length}）</SectionTitle>
                  {children.length === 0 ? (
                    <p className="text-muted-foreground">没有子进程</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {children.map((child) => (
                        <Item
                          key={child.pid}
                          size="xs"
                          variant="muted"
                          className="cursor-pointer"
                          onClick={() => model.selectProcess(child.pid)}
                        >
                          <ProcessAvatar name={child.name} />
                          <ItemContent>
                            <ItemTitle className="truncate">
                              {child.name}
                            </ItemTitle>
                            <ItemDescription>PID {child.pid}</ItemDescription>
                          </ItemContent>
                          <ItemActions>
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {child.cpu.toFixed(1)}% ·{" "}
                              {formatBytes(child.memoryBytes)}
                            </span>
                          </ItemActions>
                        </Item>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </ScrollArea>

            <div className="flex items-center gap-2 border-t p-4">
              <span className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
                <HugeiconsIcon
                  icon={ownedByCurrentUser ? InformationCircleIcon : LockIcon}
                  className="size-3.5"
                />
                {ownedByCurrentUser
                  ? "结束前请确认进程不需要保存数据"
                  : "系统进程，需要管理员权限"}
              </span>
              <Button
                variant="destructive"
                size="sm"
                className="ml-auto"
                onClick={() => onRequestTerminate([selected], true)}
              >
                强制结束
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRequestTerminate([selected], false)}
              >
                结束进程
              </Button>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

const SectionTitle = ({ children }: { children: ReactNode }) => (
  <h2 className="pb-1 text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
    {children}
  </h2>
)

const DetailRow = ({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) => (
  <div className="flex items-start gap-3 py-1">
    <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
    <span className="min-w-0 flex-1 break-all">{children}</span>
  </div>
)
