/**
 * 写操作的响应阈值：服务端在这段时间内完成，就直接返回真实结果；
 * 否则返回受理回执与任务标识，由客户端按任务查询。
 *
 * 它是「什么时候改变响应方式」，不是执行时限：超过阈值不会取消已经开始的动
 * 作，也不会让客户端重发。前端不做计时、不做中断。
 */
export const TASK_RESPONSE_THRESHOLD_MS = 5000

/** 进度落库的最小间隔，避免高频上报打满 sqlite。 */
export const TASK_PROGRESS_THROTTLE_MS = 300

/** 已终结任务的保留条数，控制任务表规模。 */
export const TASK_HISTORY_KEEP = 200

/** 单进程同时执行的任务上限。 */
export const TASK_MAX_CONCURRENCY = 4

/** 进度没有真实数字时的展示兜底前缀；它不是进度，只是已用时间。 */
export const TASK_ELAPSED_PREFIX = "已运行"
