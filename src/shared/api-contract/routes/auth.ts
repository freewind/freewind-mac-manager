import { ApiPath, toContractPath } from "@shared/api-path"
import { c } from "../init"
import {
  AuthErrorSchema,
  AuthResultSchema,
  AuthStatusSchema,
  CsrfTokenSchema,
  LoginBodySchema,
} from "../schemas/auth"

export const authRoutes = {
  getAuthCsrf: {
    method: "GET",
    path: toContractPath(ApiPath.authCsrf),
    responses: { 200: CsrfTokenSchema },
  },
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
      403: AuthErrorSchema,
      429: AuthErrorSchema,
    },
  },
  logout: {
    method: "POST",
    path: toContractPath(ApiPath.authLogout),
    body: c.noBody(),
    responses: {
      200: AuthResultSchema,
      403: AuthErrorSchema,
    },
  },
} as const
