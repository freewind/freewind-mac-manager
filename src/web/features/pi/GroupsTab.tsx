import {
  Add01Icon,
  CancelCircleIcon,
  Delete02Icon,
  Edit01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  addPiModelGroup,
  deletePiModelGroup,
  replacePiModelGroup,
} from "@shared/client-api"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ActionButton } from "@web/components/ActionButton"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@web/components/ui/alert-dialog"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@web/components/ui/field"
import { Input } from "@web/components/ui/input"
import { Label } from "@web/components/ui/label"
import { useDialogSubmit } from "@web/hooks/use-dialog-submit"
import { useState } from "react"
import { toast } from "sonner"
import { piKeys, usePiModelGroups, usePiModels } from "./queries"

type GroupEntry = ReturnType<typeof usePiModelGroups>["data"] extends infer T
  ? T extends { groups: (infer G)[] }
    ? G
    : never
  : never

type MemberDraft = { key: string; provider: string; modelId: string }

type GroupDraft = {
  groupId: string
  name: string
  contextWindow: string
  maxTokens: string
  members: MemberDraft[]
}

/** 分组 id 规则与后端一致：字母数字与 _ . : @ / - 组成。 */
const GROUP_ID_PATTERN = /^[\p{L}\p{N}_.:@/-]+$/u

const emptyMember = (): MemberDraft => ({
  key: crypto.randomUUID(),
  provider: "",
  modelId: "",
})

const emptyDraft = (): GroupDraft => ({
  groupId: "",
  name: "",
  contextWindow: "",
  maxTokens: "",
  members: [emptyMember()],
})

export const GroupsTab = () => {
  const queryClient = useQueryClient()
  const groups = usePiModelGroups()
  const models = usePiModels()
  const [draft, setDraft] = useState<GroupDraft | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<GroupEntry | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: piKeys.modelGroups() })

  const startEdit = (entry?: GroupEntry) => {
    setFormError(null)
    if (!entry) {
      setEditingId(null)
      setDraft(emptyDraft())
      return
    }
    setEditingId(entry.id)
    setDraft({
      groupId: entry.id,
      name: entry.group.name,
      contextWindow: entry.group.contextWindow?.toString() ?? "",
      maxTokens: entry.group.maxTokens?.toString() ?? "",
      members: entry.group.members.map((member) => ({
        ...member,
        key: crypto.randomUUID(),
      })),
    })
  }

  const submission = useDialogSubmit(() => {
    setDraft(null)
    setFormError(null)
  })

  const save = useMutation({
    mutationFn: async () => {
      if (!draft || !groups.data) throw new Error("请先读取分组配置")
      const groupId = draft.groupId.trim()
      if (!GROUP_ID_PATTERN.test(groupId)) {
        throw new Error("分组 id 只能包含字母数字与 _ . : @ / -")
      }
      const members = draft.members
        .map((member) => ({
          provider: member.provider.trim(),
          modelId: member.modelId.trim(),
        }))
        .filter((member) => member.provider && member.modelId)
      if (members.length === 0) throw new Error("至少需要一名成员")
      const seen = new Set(
        members.map((member) => `${member.provider}/${member.modelId}`)
      )
      if (seen.size !== members.length)
        throw new Error("成员重复，同一模型不能出现两次")
      const parsePositive = (value: string, label: string) => {
        if (!value) return undefined
        const parsed = Number(value)
        if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 10_000_000)
          throw new Error(`${label}必须是正整数`)
        return parsed
      }
      const group = {
        name: draft.name.trim() || groupId,
        contextWindow: parsePositive(draft.contextWindow, "上下文窗口"),
        maxTokens: parsePositive(draft.maxTokens, "最大输出"),
        members,
      }
      return editingId
        ? replacePiModelGroup(editingId, {
            signature: groups.data.signature,
            group,
          })
        : addPiModelGroup({
            groupId,
            signature: groups.data.signature,
            group,
          })
    },
    onSuccess: async (response) => {
      if (response.status < 200 || response.status >= 300) {
        toast.error("保存未完成，请检查配置并刷新后重试")
        return
      }
      toast.success("分组已保存，重启 Pi 会话后生效")
      setDraft(null)
      setEditingId(null)
      await invalidate()
    },
    onError: (error) =>
      toast.error(error.message || "保存失败，请刷新配置核实"),
  })

  const remove = useMutation({
    mutationFn: async (entry: GroupEntry) =>
      deletePiModelGroup({
        groupId: entry.id,
        signature: groups.data?.signature ?? "",
      }),
    onSuccess: async (response) => {
      if (response.status !== 204) {
        toast.error("删除未完成，请刷新配置核实")
        return
      }
      toast.success("分组已删除，重启 Pi 会话后生效")
      setDeleteTarget(null)
      await invalidate()
    },
    onError: (error) =>
      toast.error(error.message || "删除失败，请刷新配置核实"),
  })

  const updateMember = (index: number, patch: Partial<MemberDraft>): void => {
    if (!draft) return
    setDraft({
      ...draft,
      members: draft.members.map((member, current) =>
        current === index ? { ...member, ...patch } : member
      ),
    })
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>模型分组</CardTitle>
          <CardDescription>
            分组注册为虚拟模型 grp/&lt;分组
            id&gt;，请求失败时在同组成员间换路由。 改动写入配置文件，需重启 Pi
            会话后生效。
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void groups.refetch()}
          disabled={groups.isFetching}
        >
          <HugeiconsIcon icon={RefreshIcon} />
          刷新
        </Button>
        <Button size="sm" onClick={() => startEdit()}>
          <HugeiconsIcon icon={Add01Icon} />
          添加分组
        </Button>
      </div>

      {groups.isLoading ? <p role="status">正在读取分组配置…</p> : null}
      {groups.isError ? (
        <Card>
          <CardHeader>
            <CardTitle>分组配置读取失败</CardTitle>
            <CardDescription>
              {groups.error instanceof Error
                ? groups.error.message
                : "请刷新重试"}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
      {groups.data && groups.data.groups.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>还没有分组</CardTitle>
            <CardDescription>
              添加第一个分组，把可互换的模型放进同一路由池。
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {(groups.data?.groups ?? []).map((entry) => (
          <Card key={entry.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="truncate">{entry.group.name}</CardTitle>
                  <CardDescription className="truncate">
                    grp/{entry.id}
                  </CardDescription>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`编辑分组 ${entry.group.name}`}
                    onClick={() => startEdit(entry)}
                  >
                    <HugeiconsIcon icon={Edit01Icon} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`删除分组 ${entry.group.name}`}
                    onClick={() => setDeleteTarget(entry)}
                  >
                    <HugeiconsIcon icon={Delete02Icon} />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-2 flex flex-wrap gap-1">
                <Badge variant="secondary">
                  {entry.group.members.length} 名成员
                </Badge>
                {entry.group.contextWindow ? (
                  <Badge variant="outline">
                    上下文 {entry.group.contextWindow.toLocaleString()}
                  </Badge>
                ) : null}
                {entry.group.maxTokens ? (
                  <Badge variant="outline">
                    最大输出 {entry.group.maxTokens.toLocaleString()}
                  </Badge>
                ) : null}
              </div>
              <ul className="space-y-1">
                {entry.group.members.map((member) => (
                  <li
                    key={`${member.provider}-${member.modelId}`}
                    className="truncate font-mono text-xs text-muted-foreground"
                  >
                    {member.provider}/{member.modelId}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open && !submission.busy) {
            setDraft(null)
            setFormError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "编辑分组" : "添加分组"}</DialogTitle>
            <DialogDescription>
              成员必须是已有 Provider 中的模型；保存后需重启 Pi 会话生效。
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="pi-group-id">分组 id</FieldLabel>
                <Input
                  id="pi-group-id"
                  value={draft.groupId}
                  autoComplete="off"
                  disabled={editingId !== null}
                  placeholder="例如 g-mimo"
                  onChange={(event) =>
                    setDraft({ ...draft, groupId: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="pi-group-name">展示名</FieldLabel>
                <Input
                  id="pi-group-name"
                  value={draft.name}
                  autoComplete="off"
                  placeholder="留空时使用分组 id"
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="pi-group-context">上下文窗口</FieldLabel>
                  <Input
                    id="pi-group-context"
                    value={draft.contextWindow}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="可选"
                    onChange={(event) =>
                      setDraft({ ...draft, contextWindow: event.target.value })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="pi-group-max">最大输出</FieldLabel>
                  <Input
                    id="pi-group-max"
                    value={draft.maxTokens}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="可选"
                    onChange={(event) =>
                      setDraft({ ...draft, maxTokens: event.target.value })
                    }
                  />
                </Field>
              </div>
              <Field data-invalid={formError !== null ? true : undefined}>
                <FieldLabel>成员</FieldLabel>
                <div className="space-y-2">
                  {draft.members.map((member, index) => (
                    <div key={member.key} className="flex items-center gap-2">
                      <div className="grid flex-1 grid-cols-2 gap-2">
                        <Label
                          className="sr-only"
                          htmlFor={`member-provider-${index}`}
                        >
                          成员 {index + 1} Provider
                        </Label>
                        <select
                          id={`member-provider-${index}`}
                          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                          value={member.provider}
                          onChange={(event) =>
                            updateMember(index, {
                              provider: event.target.value,
                              modelId: "",
                            })
                          }
                        >
                          <option value="">选择 Provider</option>
                          {(models.data?.providers ?? []).map((provider) => (
                            <option key={provider.id} value={provider.id}>
                              {provider.id}
                            </option>
                          ))}
                        </select>
                        <Label
                          className="sr-only"
                          htmlFor={`member-model-${index}`}
                        >
                          成员 {index + 1} 模型
                        </Label>
                        <select
                          id={`member-model-${index}`}
                          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                          value={member.modelId}
                          onChange={(event) =>
                            updateMember(index, {
                              modelId: event.target.value,
                            })
                          }
                        >
                          <option value="">选择模型</option>
                          {(
                            models.data?.providers.find(
                              (provider) => provider.id === member.provider
                            )?.provider.models ?? []
                          ).map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.id}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`移除成员 ${index + 1}`}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            members:
                              draft.members.length > 1
                                ? draft.members.filter(
                                    (_, current) => current !== index
                                  )
                                : [emptyMember()],
                          })
                        }
                      >
                        <HugeiconsIcon icon={CancelCircleIcon} />
                      </Button>
                    </div>
                  ))}
                </div>
                {formError ? <FieldError>{formError}</FieldError> : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      members: [...draft.members, emptyMember()],
                    })
                  }
                >
                  <HugeiconsIcon icon={Add01Icon} />
                  添加成员
                </Button>
              </Field>
            </FieldGroup>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDraft(null)
                setFormError(null)
              }}
              disabled={submission.busy}
            >
              取消
            </Button>
            <ActionButton
              onClick={() =>
                void submission.submit(async () => {
                  const invalid = draft?.members.some(
                    (member) =>
                      (member.provider && !member.modelId) ||
                      (!member.provider && member.modelId)
                  )
                  setFormError(
                    invalid ? "成员必须同时选择 Provider 和模型" : null
                  )
                  if (invalid) return false
                  await save.mutateAsync()
                  return true
                })
              }
              disabled={!draft}
              busy={submission.busy || save.isPending}
              busyLabel="正在保存…"
            >
              保存
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除分组 {deleteTarget?.group.name ?? ""}？
            </AlertDialogTitle>
            <AlertDialogDescription>
              删除只移除分组定义，不影响成员 Provider 与模型； 共{" "}
              {deleteTarget?.group.members.length ?? 0} 名成员将失去 grp/
              {deleteTarget?.id ?? ""} 虚拟模型，重启 Pi 会话后生效。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              取消
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTarget) remove.mutate(deleteTarget)
              }}
              disabled={remove.isPending}
            >
              删除分组 {deleteTarget?.group.name ?? ""}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
