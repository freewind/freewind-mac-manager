import { ApiPath, toContractPath } from "@shared/api-path"
import { ApiErrorSchema } from "../schemas/common"
import {
  TaskIdPathParamsSchema,
  TaskListQuerySchema,
  TaskListResponseSchema,
  TaskRecordSchema,
} from "../schemas/tasks"

const errorResponses = {
  400: ApiErrorSchema,
  401: ApiErrorSchema,
  500: ApiErrorSchema,
} as const

/** 任务查询只读，不产生业务写入副作用。 */
export const tasksRoutes = {
  listTasks: {
    method: "GET",
    path: toContractPath(ApiPath.tasks),
    query: TaskListQuerySchema,
    responses: {
      200: TaskListResponseSchema,
      ...errorResponses,
    },
  },
  getTask: {
    method: "GET",
    path: toContractPath(ApiPath.task),
    pathParams: TaskIdPathParamsSchema,
    responses: {
      200: TaskRecordSchema,
      ...errorResponses,
      404: ApiErrorSchema,
    },
  },
} as const
