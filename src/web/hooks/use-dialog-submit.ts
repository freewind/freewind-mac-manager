import { describeError } from "@shared/format"
import { useRef, useState } from "react"
import { toast } from "sonner"

/** 弹窗等待受理回执，失败保留上下文；同步锁覆盖 React 更新前的重复提交。 */
export const useDialogSubmit = (onClose: () => void, externalBusy = false) => {
  const [submitting, setSubmitting] = useState(false)
  const locked = useRef(false)
  const submit = async (action: () => Promise<boolean>): Promise<void> => {
    if (locked.current || externalBusy) return
    locked.current = true
    setSubmitting(true)
    try {
      if (await action()) onClose()
    } catch (error) {
      toast.error(describeError(error))
    } finally {
      locked.current = false
      setSubmitting(false)
    }
  }
  return { busy: submitting || externalBusy, submit }
}
