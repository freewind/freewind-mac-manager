import { ApiPath, toContractPath } from "@shared/api-path"
import {
  AuthErrorSchema,
  AuthResultSchema,
  AuthStatusSchema,
  LoginBodySchema,
} from "../schemas/auth"

export const authRoutes = {
  getAuthStatus: {
    method: "GET",
    path: toContractPath(ApiPath.authStatus),
    responses: { 200: AuthStatusSchema },
  },
  login: {
    method: "POST",
    path: toContractPath(ApiPath.authLogin),
    body: LoginBodySchema,
    responses: {
      200: AuthResultSchema,
      401: AuthErrorSchema,
      429: AuthErrorSchema,
    },
  },
} as const
