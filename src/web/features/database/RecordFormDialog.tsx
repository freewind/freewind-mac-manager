import { Add01Icon, PencilEdit02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type {
  DatabaseColumn,
  DatabaseRecord,
  DatabaseTable,
  SqliteWritableValue,
} from "@shared/api-contract"
import { ActionButton } from "@web/components/ActionButton"
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert"
import { Badge } from "@web/components/ui/badge"
import { Button } from "@web/components/ui/button"
import { Checkbox } from "@web/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@web/components/ui/field"
import { Input } from "@web/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@web/components/ui/select"
import { useState } from "react"
import {
  buildInsertValues,
  buildUpdateValues,
  type ColumnFormMode,
  type ColumnFormState,
  type RecordFormState,
  writableColumnsOf,
} from "./form-values"
import { formatColumnDefault, formatSqliteValue } from "./format"

const MODE_LABELS: Record<ColumnFormMode, string> = {
  omit: "用默认值",
  null: "NULL",
  value: "输入值",
}

export type RecordFormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  table: DatabaseTable
  /** null 表示新增。 */
  record: DatabaseRecord | null
  /** 打开表单时的初始状态，用于判断哪些字段真正改动过。 */
  initial: RecordFormState
  /** 当前草稿；由页面持有，切表与草稿保护都以它为准。 */
  state: RecordFormState
  /** 只上报「改了哪一列」，避免闭包里拿到过期的整份草稿。 */
  onChangeColumn: (name: string, next: ColumnFormState) => void
  busy: boolean
  /** 有未保存草稿时禁止点外部关闭，避免默默丢掉草稿。 */
  preventOutsideDismiss?: boolean
  /** 服务端返回的失败原因（400/409）：留在表单里，草稿不丢。 */
  failure: string | null
  /** 结果未知：禁止再次提交，只能重新读取核实。 */
  unknownNotice: string | null
  onVerify: () => void
  onDismissUnknown: () => void
  onSubmit: (values: Record<string, SqliteWritableValue>) => void
}

const ReadOnlyField = (props: {
  column: DatabaseColumn
  record: DatabaseRecord | null
}) => {
  const value = props.record?.values[props.column.name]
  return (
    <Field>
      <FieldLabel>
        {props.column.name}
        <Badge variant="outline">只读</Badge>
      </FieldLabel>
      <p className="text-sm break-all text-muted-foreground">
        {value === undefined
          ? props.column.write.allowed
            ? "新增时由数据库生成"
            : props.column.write.message
          : formatSqliteValue(value)}
      </p>
      <FieldDescription>
        {props.column.write.allowed
          ? "新增时不需要填写"
          : props.column.write.message}
        {props.column.defaultValue === undefined
          ? ""
          : ` · 默认值 ${formatColumnDefault(props.column)}`}
      </FieldDescription>
    </Field>
  )
}

/**
 * 新增 / 修改表单：字段按真实结构生成，只读字段（主键在修改时、生成列、BLOB 列）
 * 不提供输入；修改只提交变化过的字段；失败保留草稿，结果未知时禁止再次提交。
 */
export const RecordFormDialog = (props: RecordFormDialogProps) => {
  const isInsert = props.record === null
  const [errors, setErrors] = useState<Record<string, string>>({})
  const initial = props.initial
  const form = props.state

  // 新增时主键可以自己填；修改时主键是定位条件，不能改
  const editable = isInsert
    ? writableColumnsOf(props.table)
    : writableColumnsOf(props.table).filter(
        (column) => column.primaryKeyPosition === 0
      )
  const readOnly = props.table.columns.filter(
    (column) => !editable.includes(column)
  )
  const blockedByUnknown = props.unknownNotice !== null

  const patch = (name: string, next: ColumnFormState): void => {
    props.onChangeColumn(name, next)
  }

  const submit = (): void => {
    if (props.busy || blockedByUnknown) return
    const result = isInsert
      ? buildInsertValues(props.table, form)
      : buildUpdateValues(props.table, initial, form)
    if (Object.keys(result.errors).length > 0) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    props.onSubmit(result.values)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      disablePointerDismissal={props.preventOutsideDismiss === true}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isInsert ? "新增记录" : "修改记录"} · {props.table.name}
          </DialogTitle>
          <DialogDescription>
            {isInsert
              ? "按真实字段填写：选择「用默认值」的列不会出现在写入请求里，交给数据库决定。"
              : "只提交改动过的字段；主键、生成列与 BLOB 列不能修改。"}
          </DialogDescription>
        </DialogHeader>

        {props.failure === null ? null : (
          <Alert variant="destructive">
            <AlertTitle>提交失败</AlertTitle>
            <AlertDescription>{props.failure}</AlertDescription>
          </Alert>
        )}

        {props.unknownNotice === null ? null : (
          <Alert>
            <AlertTitle>结果未知</AlertTitle>
            <AlertDescription className="space-y-2">
              <span>{props.unknownNotice}</span>
              <span className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={props.onVerify}
                >
                  重新读取核实
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-11"
                  onClick={props.onDismissUnknown}
                >
                  已核对，继续
                </Button>
              </span>
            </AlertDescription>
          </Alert>
        )}

        <FieldGroup>
          {editable.map((column) => {
            const state = form[column.name] ?? { mode: "null", text: "" }
            const error = errors[column.name]
            return (
              <Field key={column.name} data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor={`record-field-${column.name}`}>
                  {column.name}
                  <Badge variant="outline">
                    {column.declaredType === ""
                      ? "无类型"
                      : column.declaredType}
                  </Badge>
                  {column.primaryKeyPosition > 0 ? (
                    <Badge variant="secondary">主键</Badge>
                  ) : null}
                  {column.notNull ? (
                    <Badge variant="secondary">非空</Badge>
                  ) : null}
                </FieldLabel>

                {isInsert ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={state.mode}
                      onValueChange={(next) =>
                        patch(column.name, {
                          mode: (next ?? "value") as ColumnFormMode,
                          text: state.text,
                        })
                      }
                    >
                      <SelectTrigger
                        className="min-h-11"
                        aria-label={`${column.name} 取值方式`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(MODE_LABELS) as ColumnFormMode[]).map(
                          (mode) => (
                            <SelectItem key={mode} value={mode}>
                              {MODE_LABELS[mode]}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                    {state.mode === "value" ? (
                      <Input
                        id={`record-field-${column.name}`}
                        className="min-h-11 flex-1"
                        value={state.text}
                        onChange={(event) =>
                          patch(column.name, {
                            mode: "value",
                            text: event.target.value,
                          })
                        }
                      />
                    ) : null}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      id={`record-field-${column.name}`}
                      className="min-h-11 flex-1"
                      value={state.text}
                      disabled={state.mode === "null"}
                      onChange={(event) =>
                        patch(column.name, {
                          mode: "value",
                          text: event.target.value,
                        })
                      }
                    />
                    {column.notNull ? null : (
                      <span className="flex items-center gap-2">
                        <Checkbox
                          id={`record-null-${column.name}`}
                          checked={state.mode === "null"}
                          onCheckedChange={(next) =>
                            patch(column.name, {
                              mode: next === true ? "null" : "value",
                              text: state.text,
                            })
                          }
                        />
                        <FieldLabel htmlFor={`record-null-${column.name}`}>
                          设为 NULL
                        </FieldLabel>
                      </span>
                    )}
                  </div>
                )}

                <FieldDescription>
                  默认值 {formatColumnDefault(column)}
                </FieldDescription>
                {error ? <FieldError>{error}</FieldError> : null}
              </Field>
            )
          })}

          {readOnly.map((column) => (
            <ReadOnlyField
              key={column.name}
              column={column}
              record={props.record}
            />
          ))}
        </FieldGroup>

        <DialogFooter>
          <DialogClose
            render={<Button variant="outline" className="min-h-11" />}
          >
            取消
          </DialogClose>
          <ActionButton
            className="min-h-11"
            busy={props.busy}
            busyLabel={isInsert ? "正在新增…" : "正在保存…"}
            disabled={blockedByUnknown}
            onClick={submit}
          >
            <HugeiconsIcon
              icon={isInsert ? Add01Icon : PencilEdit02Icon}
              aria-hidden="true"
            />
            {isInsert ? "新增记录" : "保存修改"}
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
