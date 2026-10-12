import type { DockerImage } from "@shared/api-contract"
import { formatBytes, formatTimestamp } from "@shared/format"
import { ActionButton } from "@web/components/ActionButton"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@web/components/ui/alert-dialog"
import { Button } from "@web/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@web/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@web/components/ui/field"
import { Input } from "@web/components/ui/input"
import { Skeleton } from "@web/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@web/components/ui/tooltip"
import { useDockerImages } from "@web/features/docker/useDocker"
import { useDialogSubmit } from "@web/hooks/use-dialog-submit"
import { useIsDesktop } from "@web/hooks/use-is-desktop"
import { Download, Trash2 } from "lucide-react"
import { useState } from "react"

/** 与后端契约一致的镜像引用白名单；首字符必须是字母数字。 */
const IMAGE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/

const imageLabelOf = (image: DockerImage): string =>
  `${image.repository}:${image.tag}`

export const ImageList = () => {
  const model = useDockerImages()
  const isDesktop = useIsDesktop()
  const submission = useDialogSubmit(
    () => model.cancelRemove(),
    model.action.busy
  )

  const pending = model.pendingRemove

  const confirmRemove = (force?: boolean): void => {
    if (!pending) return
    void submission.submit(() =>
      model.action.run({
        image: imageLabelOf(pending),
        action: "remove",
        force,
      })
    )
  }

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">镜像</h2>
        <p className="text-xs text-muted-foreground">
          {model.isLoading
            ? "拉取进度在任务中心查看"
            : `共 ${model.images.length} 个；拉取进度在任务中心查看`}
        </p>
        <Button
          variant="outline"
          className="ml-auto min-h-11 shrink-0 px-3"
          onClick={model.openPull}
          disabled={model.action.busy}
        >
          <Download aria-hidden="true" />
          拉取镜像
        </Button>
      </div>

      {model.error ? (
        <p className="text-sm text-destructive" role="alert">
          读取镜像列表失败：{model.error}
        </p>
      ) : null}

      {/* 失败原因（如被容器引用）持续展示，不用 toast 代替 */}
      {model.failure ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>操作没有完成</AlertTitle>
          <AlertDescription>{model.failure}</AlertDescription>
        </Alert>
      ) : null}

      {model.isLoading ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">正在读取镜像列表…</p>
          <Skeleton className="h-20 w-full" />
        </div>
      ) : model.images.length === 0 ? (
        <Empty className="py-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Download />
            </EmptyMedia>
            <EmptyTitle>没有镜像</EmptyTitle>
            <EmptyDescription>
              用「拉取镜像」输入镜像地址，或 docker pull 之后会出现在这里。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : isDesktop ? (
        <ImageTable
          images={model.images}
          busy={model.action.busy}
          onRemove={model.requestRemove}
        />
      ) : (
        <ImageCards
          images={model.images}
          busy={model.action.busy}
          onRemove={model.requestRemove}
        />
      )}

      <PullImageDialog
        open={model.pullOpen}
        busy={model.action.busy}
        failure={model.failure}
        onOpenChange={(open) => {
          if (open) model.openPull()
          else model.closePull()
        }}
        onSubmit={(image) => {
          void model.action.run({ image, action: "pull" }).then((started) => {
            if (started) model.closePull()
          })
        }}
      />

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) model.cancelRemove()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除镜像 {pending ? imageLabelOf(pending) : ""}？
            </AlertDialogTitle>
            <AlertDialogDescription>
              删除只影响本地镜像层，不会删除容器、卷或绑定目录；
              {pending && pending.containers > 0
                ? `当前有 ${pending.containers} 个容器使用它。被引用的镜像需要先删除相关容器，或显式选择强制删除。`
                : "当前没有容器使用它。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {model.failure ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{model.failure}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submission.busy}>
              取消
            </AlertDialogCancel>
            <ActionButton
              variant="destructive"
              busy={submission.busy}
              busyLabel="正在删除…"
              onClick={() => confirmRemove()}
            >
              删除镜像 {pending ? imageLabelOf(pending) : ""}
            </ActionButton>
            {pending && pending.containers > 0 ? (
              <ActionButton
                variant="destructive"
                busy={submission.busy}
                busyLabel="正在强制删除…"
                onClick={() => confirmRemove(true)}
              >
                强制删除镜像 {imageLabelOf(pending)}
              </ActionButton>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

const PullImageDialog = (props: {
  open: boolean
  busy: boolean
  failure: string | null
  onOpenChange: (open: boolean) => void
  onSubmit: (image: string) => void
}) => {
  const [value, setValue] = useState("")
  const [touched, setTouched] = useState(false)
  const trimmed = value.trim()
  const invalid = trimmed.length === 0 || !IMAGE_REFERENCE_PATTERN.test(trimmed)

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>拉取镜像</DialogTitle>
          <DialogDescription>
            只拉取本地没有的镜像；进度与结果在任务中心查看，这里不显示估算进度。
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field data-invalid={touched && invalid ? true : undefined}>
            <FieldLabel htmlFor="docker-image-ref">镜像地址</FieldLabel>
            <Input
              id="docker-image-ref"
              value={value}
              autoComplete="off"
              placeholder="例如 alpine:3.20"
              aria-describedby="docker-image-ref-hint"
              onChange={(event) => setValue(event.target.value)}
              onBlur={() => setTouched(true)}
            />
            <FieldDescription id="docker-image-ref-hint">
              形如 repository:tag，只允许字母数字与 . _ / : @
              -，不能以连字符开头。
            </FieldDescription>
            {touched && invalid ? (
              <FieldError>
                {trimmed.length === 0 ? "请填写镜像地址" : "镜像地址格式不合法"}
              </FieldError>
            ) : null}
          </Field>
        </FieldGroup>
        {props.failure ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{props.failure}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => props.onOpenChange(false)}
            disabled={props.busy}
          >
            取消
          </Button>
          <ActionButton
            className="min-h-11"
            busy={props.busy}
            busyLabel="正在提交…"
            disabled={props.busy}
            onClick={() => {
              setTouched(true)
              if (invalid) return
              props.onSubmit(trimmed)
            }}
          >
            开始拉取
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const ImageSummary = ({ image }: { image: DockerImage }) => (
  <>
    <p className="truncate font-medium">{image.repository}</p>
    <p className="truncate text-xs text-muted-foreground">
      标签 {image.tag} · {formatBytes(image.sizeBytes)} · 创建于{" "}
      {formatTimestamp(image.createdAt / 1000)}
    </p>
  </>
)

/** 手机默认视图：单列卡片。 */
const ImageCards = (props: {
  images: DockerImage[]
  busy: boolean
  onRemove: (image: DockerImage) => void
}) => (
  <ul className="flex min-w-0 flex-col gap-2">
    {props.images.map((image) => (
      <li
        key={image.id}
        className="flex min-w-0 flex-col gap-2 rounded-md border px-3 py-2.5"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <ImageSummary image={image} />
          <p className="text-xs text-muted-foreground">
            {image.containers > 0
              ? `${image.containers} 个容器正在使用`
              : "没有容器使用"}
          </p>
        </div>
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="icon"
            className="size-11 text-destructive"
            aria-label={`删除镜像 ${imageLabelOf(image)}`}
            disabled={props.busy}
            onClick={() => props.onRemove(image)}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </li>
    ))}
  </ul>
)

/** md 及以上：表格能一次看更多列。 */
const ImageTable = (props: {
  images: DockerImage[]
  busy: boolean
  onRemove: (image: DockerImage) => void
}) => (
  <div className="min-w-0 overflow-x-auto">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>仓库</TableHead>
          <TableHead className="w-[1%] whitespace-nowrap">标签</TableHead>
          <TableHead className="w-[1%] whitespace-nowrap">大小</TableHead>
          <TableHead className="w-[1%] whitespace-nowrap">创建时间</TableHead>
          <TableHead className="w-[1%] whitespace-nowrap">被容器引用</TableHead>
          <TableHead className="w-[1%] whitespace-nowrap text-right">
            操作
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.images.map((image) => (
          <TableRow key={image.id}>
            <TableCell className="max-w-0">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="block truncate">{image.repository}</span>
                  }
                />
                <TooltipContent className="max-w-lg break-all">
                  {image.repository}
                </TooltipContent>
              </Tooltip>
            </TableCell>
            <TableCell className="w-[1%] whitespace-nowrap">
              {image.tag}
            </TableCell>
            <TableCell className="w-[1%] whitespace-nowrap">
              {formatBytes(image.sizeBytes)}
            </TableCell>
            <TableCell className="w-[1%] whitespace-nowrap text-xs text-muted-foreground">
              {formatTimestamp(image.createdAt / 1000)}
            </TableCell>
            <TableCell className="w-[1%] whitespace-nowrap">
              {image.containers > 0 ? `${image.containers} 个容器` : "—"}
            </TableCell>
            <TableCell className="w-[1%] whitespace-nowrap">
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 text-destructive"
                  aria-label={`删除镜像 ${imageLabelOf(image)}`}
                  disabled={props.busy}
                  onClick={() => props.onRemove(image)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </div>
)
