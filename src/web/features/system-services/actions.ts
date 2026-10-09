/** 界面能触发的七种 launchd 操作。 */
export type ServiceAction =
  | "start"
  | "stop"
  | "restart"
  | "load"
  | "unload"
  | "disable"
  | "enable"

/** 会改状态、可能影响开机行为的操作，先让用户确认。 */
export const CONFIRM_REQUIRED: ServiceAction[] = [
  "stop",
  "restart",
  "unload",
  "disable",
]
