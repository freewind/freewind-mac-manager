export type PublicErrorStatus = 400 | 403 | 404 | 409 | 500

export class PublicOperationError extends Error {
  constructor(
    readonly status: PublicErrorStatus,
    message: string
  ) {
    super(message)
    this.name = "PublicOperationError"
  }
}

/** 未识别系统异常不回传命令输出、内部路径或堆栈。 */
export const publicSystemError = (
  error: unknown
): { status: PublicErrorStatus; body: { message: string } } => {
  if (error instanceof PublicOperationError)
    return { status: error.status, body: { message: error.message } }
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : null
  switch (code) {
    case "ENOENT":
      return { status: 404, body: { message: "目标不存在" } }
    case "EACCES":
    case "EPERM":
      return { status: 403, body: { message: "没有操作权限" } }
    case "EEXIST":
    case "EBUSY":
      return { status: 409, body: { message: "目标存在冲突或正被占用" } }
    default:
      return {
        status: 500,
        body: { message: "操作未能完成，请重新读取目标核实" },
      }
  }
}
